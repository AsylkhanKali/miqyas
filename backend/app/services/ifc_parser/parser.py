"""
IFC Parser Service — extracts BIM elements from .ifc files using IfcOpenShell.

Usage:
    parser = IFCParserService(db_session)
    await parser.parse(bim_model_id)

Extracts:
    - All physical building elements (walls, slabs, columns, beams, doors, windows, etc.)
    - Property sets (Pset_*) and quantity sets (Qto_*)
    - Geometry bounding boxes
    - Storey/level assignments
    - Material assignments
"""

import logging
from pathlib import Path
from typing import Any
from uuid import UUID

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element
import ifcopenshell.util.placement
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import BIMElement, BIMModel, ElementCategory

logger = logging.getLogger(__name__)

# Mapping from IFC entity types to our simplified categories
IFC_TYPE_TO_CATEGORY: dict[str, ElementCategory] = {
    "IfcWall": ElementCategory.WALL,
    "IfcWallStandardCase": ElementCategory.WALL,
    "IfcCurtainWall": ElementCategory.CURTAIN_WALL,
    "IfcSlab": ElementCategory.SLAB,
    "IfcColumn": ElementCategory.COLUMN,
    "IfcBeam": ElementCategory.BEAM,
    "IfcDoor": ElementCategory.DOOR,
    "IfcWindow": ElementCategory.WINDOW,
    "IfcStair": ElementCategory.STAIR,
    "IfcStairFlight": ElementCategory.STAIR,
    "IfcRailing": ElementCategory.RAILING,
    "IfcCovering": ElementCategory.CEILING,
    "IfcFlowTerminal": ElementCategory.MEP,
    "IfcFlowSegment": ElementCategory.MEP,
    "IfcFlowFitting": ElementCategory.MEP,
    "IfcDistributionElement": ElementCategory.MEP,
    "IfcFurnishingElement": ElementCategory.FURNITURE,
}

# IFC entity types to extract (physical building elements)
EXTRACT_TYPES = [
    "IfcWall",
    "IfcWallStandardCase",
    "IfcCurtainWall",
    "IfcSlab",
    "IfcColumn",
    "IfcBeam",
    "IfcDoor",
    "IfcWindow",
    "IfcStair",
    "IfcStairFlight",
    "IfcRailing",
    "IfcCovering",
    "IfcFlowTerminal",
    "IfcFlowSegment",
    "IfcFlowFitting",
    "IfcDistributionElement",
    "IfcFurnishingElement",
    "IfcPlate",
    "IfcMember",
    "IfcFooting",
    "IfcPile",
    "IfcRoof",
    "IfcRamp",
    "IfcRampFlight",
]


class IFCParserService:
    """Parses an IFC file and persists extracted elements to the database."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def parse(self, bim_model_id: UUID) -> int:
        """
        Parse the IFC file for the given BIMModel and insert elements.
        Returns the count of elements extracted.
        """
        model = await self.db.get(BIMModel, bim_model_id)
        if not model:
            raise ValueError(f"BIMModel {bim_model_id} not found")

        model.parse_status = "parsing"
        await self.db.flush()

        # Resolve the storage key to a local filesystem path.
        # For local storage this is instant; for S3/R2 it downloads to a temp file.
        from app.services.storage import get_storage
        storage = get_storage()
        tmp_path: Path | None = None

        try:
            local_path = await storage.get_local_path(model.storage_path)
            # get_local_path returns a temp file for S3 — track it for cleanup
            if not storage.is_local():
                tmp_path = local_path

            ifc_file = ifcopenshell.open(str(local_path))
            elements = self._extract_elements(ifc_file)

            # Update model metadata from IFC header
            model.ifc_schema_version = ifc_file.schema
            model.extra_data = self._extract_header_metadata(ifc_file)

            # Persist elements
            db_elements = []
            for elem_data in elements:
                db_elem = BIMElement(bim_model_id=bim_model_id, **elem_data)
                db_elements.append(db_elem)

            self.db.add_all(db_elements)
            model.element_count = len(db_elements)
            model.parse_status = "parsed"
            await self.db.flush()

            logger.info(f"Parsed {len(db_elements)} elements from {model.filename}")
            return len(db_elements)

        except Exception as e:
            model.parse_status = "failed"
            model.parse_error = str(e)
            await self.db.flush()
            logger.error(f"IFC parse failed for {model.filename}: {e}")
            raise
        finally:
            # Remove temp file if we downloaded from S3/R2
            if tmp_path and tmp_path.exists():
                tmp_path.unlink(missing_ok=True)

    def _extract_elements(self, ifc_file: ifcopenshell.file) -> list[dict[str, Any]]:
        """Extract all physical elements from the IFC file."""
        # Pre-compute bounding boxes and triangle meshes in one pass
        bbox_map, mesh_map = self._compute_all_geometry(ifc_file)

        elements = []
        seen_guids = set()

        for ifc_type in EXTRACT_TYPES:
            try:
                for entity in ifc_file.by_type(ifc_type):
                    guid = entity.GlobalId
                    if guid in seen_guids:
                        continue
                    seen_guids.add(guid)

                    elem = {
                        "ifc_guid": guid,
                        "ifc_type": entity.is_a(),
                        "category": self._resolve_category(entity),
                        "name": getattr(entity, "Name", "") or "",
                        "level": self._get_storey(entity),
                        "zone": self._get_zone(entity),
                        "material": self._get_material(entity),
                        "properties": self._get_property_sets(entity),
                        "quantity_data": self._get_quantities(entity),
                        "geometry_bbox": bbox_map.get(guid),
                        "geometry_mesh": mesh_map.get(guid),
                    }
                    elements.append(elem)
            except Exception as e:
                logger.warning(f"Error extracting {ifc_type}: {e}")
                continue

        return elements

    # Maximum vertex count per element before we skip mesh storage (to keep JSONB reasonable)
    _MAX_MESH_VERTICES = 10_000

    def _compute_all_geometry(
        self, ifc_file: ifcopenshell.file
    ) -> tuple[dict[str, dict], dict[str, dict]]:
        """
        Compute bounding boxes AND triangle meshes for all elements in one pass.

        Returns (bbox_map, mesh_map) where:
          bbox_map[guid] = {"min": [x,y,z], "max": [x,y,z]}
          mesh_map[guid] = {"vertices": [[x,y,z],...], "faces": [[i,j,k],...]}

        Resilient: a single failing element must not kill the whole iteration —
        we advance the iterator in a per-step try/except. If the iterator itself
        cannot be initialised at all, we fall back to ObjectPlacement-based
        bbox estimation so the viewer still gets *something*.
        """
        bbox_map: dict[str, dict] = {}
        mesh_map: dict[str, dict] = {}
        skipped = 0
        total_seen = 0

        try:
            settings = ifcopenshell.geom.settings()
            settings.set(settings.USE_WORLD_COORDS, True)
            iterator = ifcopenshell.geom.iterator(
                settings, ifc_file, multiprocessing=False
            )

            if not iterator.initialize():
                logger.warning(
                    "ifcopenshell.geom.iterator.initialize() returned False — "
                    "file may have no representable geometry. Falling back to "
                    "placement-based bbox estimation."
                )
                return self._placement_bbox_fallback(ifc_file), mesh_map

            while True:
                total_seen += 1
                try:
                    shape = iterator.get()
                    guid = shape.guid
                    geom = shape.geometry
                    verts = geom.verts
                    faces = geom.faces

                    if verts:
                        xs = verts[0::3]
                        ys = verts[1::3]
                        zs = verts[2::3]

                        bbox_map[guid] = {
                            "min": [round(min(xs), 4), round(min(ys), 4), round(min(zs), 4)],
                            "max": [round(max(xs), 4), round(max(ys), 4), round(max(zs), 4)],
                        }

                        n_verts = len(xs)
                        if n_verts <= self._MAX_MESH_VERTICES and faces:
                            vertices = [
                                [round(xs[i], 4), round(ys[i], 4), round(zs[i], 4)]
                                for i in range(n_verts)
                            ]
                            tri_faces = [
                                [faces[i], faces[i + 1], faces[i + 2]]
                                for i in range(0, len(faces), 3)
                            ]
                            mesh_map[guid] = {
                                "vertices": vertices,
                                "faces": tri_faces,
                            }
                except Exception as elem_err:
                    skipped += 1
                    if skipped <= 5:
                        logger.warning(
                            f"Geometry extraction failed for one element: {elem_err}"
                        )

                try:
                    if not iterator.next():
                        break
                except Exception as next_err:
                    logger.error(
                        f"iterator.next() raised, aborting geometry pass: {next_err}"
                    )
                    break
        except Exception as e:
            logger.exception(f"Geometry iterator aborted at top level: {e}")

        logger.info(
            f"Geometry extraction: {len(bbox_map)} bboxes, {len(mesh_map)} meshes, "
            f"{skipped} skipped of {total_seen} shapes"
        )

        # Safety net: if geom iterator produced nothing, try placement-based bbox
        if not bbox_map:
            logger.warning(
                "Geom iterator produced 0 bboxes — using placement-based fallback."
            )
            bbox_map = self._placement_bbox_fallback(ifc_file)

        return bbox_map, mesh_map

    def _placement_bbox_fallback(
        self, ifc_file: ifcopenshell.file
    ) -> dict[str, dict]:
        """
        Fallback bbox computation using ObjectPlacement transformations.

        When OCCT/shape iteration can't process an IFC file (corrupt
        representations, unsupported NURBS, missing native libs), we can still
        give the viewer a spatial approximation by reading each element's
        placement origin and using a small synthetic box around it. This is
        enough to scaffold the 3D view until proper meshes are re-parsed.
        """
        import numpy as np

        bbox_map: dict[str, dict] = {}
        half_size = 0.5  # meters — visible placeholder cube

        for ifc_type in EXTRACT_TYPES:
            try:
                entities = ifc_file.by_type(ifc_type)
            except Exception:
                continue
            for entity in entities:
                try:
                    placement = getattr(entity, "ObjectPlacement", None)
                    if placement is None:
                        continue
                    matrix = ifcopenshell.util.placement.get_local_placement(placement)
                    # Origin is the translation column of the 4x4 matrix
                    origin = np.asarray(matrix)[:3, 3]
                    x, y, z = float(origin[0]), float(origin[1]), float(origin[2])
                    bbox_map[entity.GlobalId] = {
                        "min": [round(x - half_size, 4), round(y - half_size, 4), round(z - half_size, 4)],
                        "max": [round(x + half_size, 4), round(y + half_size, 4), round(z + half_size, 4)],
                    }
                except Exception:
                    continue

        logger.info(
            f"Placement-based bbox fallback produced {len(bbox_map)} bboxes"
        )
        return bbox_map

    def _resolve_category(self, entity) -> ElementCategory:
        """Map an IFC entity to our simplified ElementCategory."""
        ifc_type = entity.is_a()
        return IFC_TYPE_TO_CATEGORY.get(ifc_type, ElementCategory.OTHER)

    def _get_storey(self, entity) -> str:
        """Get the building storey (level/floor) for an element."""
        try:
            container = ifcopenshell.util.element.get_container(entity)
            if container and container.is_a("IfcBuildingStorey"):
                return container.Name or ""
        except Exception:
            pass
        return ""

    def _get_zone(self, entity) -> str:
        """Get the spatial zone assignment if available."""
        try:
            for rel in getattr(entity, "HasAssignments", []):
                if rel.is_a("IfcRelAssignsToGroup"):
                    group = rel.RelatingGroup
                    if group.is_a("IfcZone"):
                        return group.Name or ""
        except Exception:
            pass
        return ""

    def _get_material(self, entity) -> str:
        """Extract the primary material name."""
        try:
            material = ifcopenshell.util.element.get_material(entity)
            if material:
                if material.is_a("IfcMaterial"):
                    return material.Name or ""
                elif material.is_a("IfcMaterialLayerSetUsage"):
                    layers = material.ForLayerSet.MaterialLayers
                    if layers:
                        return layers[0].Material.Name or ""
                elif material.is_a("IfcMaterialList"):
                    if material.Materials:
                        return material.Materials[0].Name or ""
        except Exception:
            pass
        return ""

    def _get_property_sets(self, entity) -> dict[str, Any]:
        """
        Extract all property sets for the element.

        Keeps standard `Pset_*` / `CPset_*` as well as vendor-prefixed sets
        (MagiCAD, Revit, ArchiCAD, etc.) — anything that isn't a quantity set.
        Quantity sets (`Qto_*`) are handled separately by `_get_quantities`.
        """
        props = {}
        try:
            psets = ifcopenshell.util.element.get_psets(entity)
            for pset_name, pset_values in psets.items():
                if pset_name.startswith("Qto_"):
                    continue  # handled by _get_quantities
                cleaned = {}
                for k, v in pset_values.items():
                    if k == "id":
                        continue
                    # Convert non-serializable values to strings
                    if isinstance(v, (str, int, float, bool, type(None))):
                        cleaned[k] = v
                    else:
                        cleaned[k] = str(v)
                if cleaned:
                    props[pset_name] = cleaned
        except Exception as e:
            logger.debug(f"get_psets failed for {getattr(entity, 'GlobalId', '?')}: {e}")
        return props

    def _get_quantities(self, entity) -> dict[str, Any]:
        """
        Extract numeric quantities — area, volume, length, etc.

        Primary source: `Qto_*` quantity sets.
        Secondary source: numeric keys from any pset whose name contains
        common quantity tokens (Area, Volume, Length, Width, Height, Weight).
        This catches vendor tools that don't follow the `Qto_` convention.
        """
        quantities: dict[str, Any] = {}
        quantity_tokens = ("Area", "Volume", "Length", "Width", "Height", "Weight", "Depth", "Perimeter")
        try:
            psets = ifcopenshell.util.element.get_psets(entity)
            for pset_name, pset_values in psets.items():
                if pset_name.startswith("Qto_"):
                    for k, v in pset_values.items():
                        if k == "id":
                            continue
                        if isinstance(v, (int, float)) and not isinstance(v, bool):
                            quantities[k] = v
                else:
                    # Harvest numeric quantity-looking fields from other psets
                    for k, v in pset_values.items():
                        if k == "id" or k in quantities:
                            continue
                        if isinstance(v, (int, float)) and not isinstance(v, bool):
                            if any(tok in k for tok in quantity_tokens):
                                quantities[k] = v
        except Exception as e:
            logger.debug(f"get_psets (qto) failed for {getattr(entity, 'GlobalId', '?')}: {e}")
        return quantities

    def _extract_header_metadata(self, ifc_file: ifcopenshell.file) -> dict:
        """Extract project-level metadata from the IFC header."""
        meta = {}
        try:
            header = ifc_file.header
            meta["description"] = str(header.file_description.description) if header.file_description else ""
            meta["implementation_level"] = str(header.file_description.implementation_level) if header.file_description else ""
            if header.file_name:
                meta["author"] = str(header.file_name.author)
                meta["organization"] = str(header.file_name.organization)
                meta["originating_system"] = str(header.file_name.originating_system)
                meta["authorization"] = str(header.file_name.authorization)
        except Exception:
            pass

        # Extract IfcProject info
        try:
            projects = ifc_file.by_type("IfcProject")
            if projects:
                p = projects[0]
                meta["project_name"] = p.Name or ""
                meta["project_description"] = p.Description or ""
                meta["project_phase"] = p.Phase or ""
        except Exception:
            pass

        return meta
