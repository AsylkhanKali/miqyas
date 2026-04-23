/**
 * IFC Mesh Loader — extracts triangle meshes from IFC files using web-ifc.
 *
 * Usage:
 *   const loader = new IFCMeshLoader();
 *   await loader.init();
 *   const meshes = await loader.loadFromUrl(ifcFileUrl);
 *   loader.dispose();
 *
 * Each returned mesh has: expressID, vertices (Float32Array), indices (Uint32Array).
 * Feed these into THREE.BufferGeometry for rendering.
 */

import { IfcAPI, IFCWALL, IFCWALLSTANDARDCASE, IFCSLAB, IFCCOLUMN, IFCBEAM,
  IFCDOOR, IFCWINDOW, IFCSTAIR, IFCSTAIRFLIGHT, IFCRAILING, IFCCOVERING,
  IFCCURTAINWALL, IFCPLATE, IFCMEMBER, IFCFOOTING, IFCROOF, IFCRAMP,
  IFCRAMPFLIGHT } from "web-ifc";

// IFC types we care about (matches backend EXTRACT_TYPES)
const IFC_TYPES = [
  IFCWALL, IFCWALLSTANDARDCASE, IFCSLAB, IFCCOLUMN, IFCBEAM,
  IFCDOOR, IFCWINDOW, IFCSTAIR, IFCSTAIRFLIGHT, IFCRAILING,
  IFCCOVERING, IFCCURTAINWALL, IFCPLATE, IFCMEMBER, IFCFOOTING,
  IFCROOF, IFCRAMP, IFCRAMPFLIGHT,
];

export interface IFCMeshData {
  expressID: number;
  ifcType: number;         // e.g. IFCWALL, IFCSLAB — raw web-ifc constant
  vertices: Float32Array;  // xyz interleaved
  indices: Uint32Array;
  flatTransformation: number[];
}

export class IFCMeshLoader {
  private api: IfcAPI;
  private initialized = false;

  constructor() {
    this.api = new IfcAPI();
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    // web-ifc needs its WASM files — served from /wasm/ by the frontend
    this.api.SetWasmPath("/wasm/");
    await this.api.Init();
    this.initialized = true;
  }

  /**
   * Load IFC file from URL and extract all mesh geometry.
   * Returns a Map from expressID to mesh data.
   */
  async loadFromUrl(url: string): Promise<Map<number, IFCMeshData>> {
    if (!this.initialized) await this.init();

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch IFC file: ${response.status}`);

    const buffer = await response.arrayBuffer();
    const data = new Uint8Array(buffer);
    const modelID = this.api.OpenModel(data);

    const meshes = this.extractMeshes(modelID);

    this.api.CloseModel(modelID);
    return meshes;
  }

  /**
   * Extract meshes for all building elements from an open model.
   */
  private extractMeshes(modelID: number): Map<number, IFCMeshData> {
    const result = new Map<number, IFCMeshData>();

    for (const ifcType of IFC_TYPES) {
      const ids = this.api.GetLineIDsWithType(modelID, ifcType);
      for (let i = 0; i < ids.size(); i++) {
        const expressID = ids.get(i);
        if (result.has(expressID)) continue;

        try {
          /* ↓ ifcType is captured from the loop variable */
          const flatMesh = this.api.GetFlatMesh(modelID, expressID);
          const geometries = flatMesh.geometries;

          if (geometries.size() === 0) continue;

          // Combine all sub-geometries for this element
          const allVerts: number[] = [];
          const allIndices: number[] = [];
          let vertexOffset = 0;

          for (let g = 0; g < geometries.size(); g++) {
            const placedGeom = geometries.get(g);
            const geomData = this.api.GetGeometry(modelID, placedGeom.geometryExpressID);

            const verts = this.api.GetVertexArray(
              geomData.GetVertexData(),
              geomData.GetVertexDataSize()
            );
            const indices = this.api.GetIndexArray(
              geomData.GetIndexData(),
              geomData.GetIndexDataSize()
            );

            // verts has 6 floats per vertex: x,y,z, nx,ny,nz
            const numVerts = verts.length / 6;

            // Extract positions only (skip normals) and apply flat transformation
            const transform = placedGeom.flatTransformation;
            for (let v = 0; v < numVerts; v++) {
              const x = verts[v * 6];
              const y = verts[v * 6 + 1];
              const z = verts[v * 6 + 2];

              // Apply 4x4 transformation matrix (column-major in web-ifc)
              const tx = transform[0] * x + transform[4] * y + transform[8] * z + transform[12];
              const ty = transform[1] * x + transform[5] * y + transform[9] * z + transform[13];
              const tz = transform[2] * x + transform[6] * y + transform[10] * z + transform[14];

              allVerts.push(tx, ty, tz);
            }

            // Offset indices for combined buffer
            for (let idx = 0; idx < indices.length; idx++) {
              allIndices.push(indices[idx] + vertexOffset);
            }

            vertexOffset += numVerts;
            geomData.delete();
          }

          if (allVerts.length > 0 && allIndices.length > 0) {
            result.set(expressID, {
              expressID,
              ifcType,
              vertices: new Float32Array(allVerts),
              indices: new Uint32Array(allIndices),
              flatTransformation: Array.from(geometries.get(0).flatTransformation),
            });
          }
        } catch {
          // Some elements may not have geometry — skip silently
        }
      }
    }

    return result;
  }

  dispose(): void {
    // IfcAPI doesn't have an explicit dispose, but we mark as uninitialized
    this.initialized = false;
  }
}
