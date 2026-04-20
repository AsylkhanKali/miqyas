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
from typing import Any
from uuid import UUID

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element
import ifcopenshell.util.placement
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

        try:
            ifc_file = ifcopenshell.open(model.storage_path)
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
        """
        bbox_map: dict[str, dict] = {}
        mesh_map: dict[str, dict] = {}

        try:
            settings = ifcopenshell.geom.settings()
            settings.set(settings.USE_WORLD_COORDS, True)
            iterator = ifcopenshell.geom.iterator(settings, ifc_file, multiprocessing=False)

            if iterator.initialize():
                while True:
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

                        # Store triangle mesh if size is reasonable
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

                    if not iterator.next():
                        break
        except Exception as e:
            logger.warning(f"Geometry iterator failed, geometry will be empty: {e}")

        logger.info(
            f"Geometry extraction: {len(bbox_map)} bboxes, {len(mesh_map)} meshes"
        )
        return bbox_map, mesh_map

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
        """Extract all property sets (Pset_*) for the element."""
        props = {}
        try:
            psets = ifcopenshell.util.element.get_psets(entity)
            for pset_name, pset_values in psets.items():
                if pset_name.startswith("Pset_") or pset_name.startswith("CPset_"):
                    cleaned = {}
                    for k, v in pset_values.items():
                        if k == "id":
                            continue
                        # Convert non-serializable values to strings
                        if isinstance(v, (str, int, float, bool, type(None))):
                            cleaned[k] = v
                        else:
                            cleaned[k] = str(v)
                    props[pset_name] = cleaned
        except Exception:
            pass
        return props

    def _get_quantities(self, entity) -> dict[str, Any]:
        """Extract quantity sets (Qto_*) — area, volume, length, etc."""
        quantities = {}
        try:
            psets = ifcopenshell.util.element.get_psets(entity)
            for pset_name, pset_values in psets.items():
                if pset_name.startswith("Qto_"):
                    for k, v in pset_values.items():
                        if k == "id":
                            continue
                        if isinstance(v, (int, float)):
                            quantities[k] = v
        except Exception:
            pass
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
