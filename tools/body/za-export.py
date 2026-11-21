# Converts one Z-Anatomy FBX to GLB, every mesh carrying its exact name and its ancestors' names in extras.
import bpy, sys
args = sys.argv[sys.argv.index('--') + 1:]
src, dst = args[0], args[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
for o in bpy.data.objects:
    chain, p = [], o.parent
    while p: chain.append(p.name); p = p.parent
    o['za_name'] = o.name
    o['za_path'] = ' / '.join(reversed(chain))
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.data.objects:
    if o.type == 'MESH' and not o.name.endswith('.j') and len(o.data.polygons) > 1:
        o.hide_set(False); o.select_set(True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_extras=True, export_apply=True, export_normals=False, export_texcoords=False, export_materials='NONE', export_yup=True)
print('EXPORTED', dst)
