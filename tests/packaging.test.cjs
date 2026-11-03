const test=require('node:test');
const {execFileSync}=require('node:child_process');
const path=require('node:path');

test('CurseForge ZIP validation rejects desktop payloads and missing addon dependencies',()=>{
  execFileSync('python3',['-c',`
import importlib.util, tempfile
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
spec=importlib.util.spec_from_file_location('validate','scripts/validate_addon_zip.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as directory:
    valid=Path(directory)/'valid.zip'
    with ZipFile(valid,'w',ZIP_DEFLATED) as out:
        for file in Path('addon/AzerothLiveMap').iterdir():
            if file.is_file():out.write(file,'AzerothLiveMap/'+file.name)
    module.validate(valid)
    for name,exclude,extra in [('desktop',None,('app/desktop.exe',b'executable')),
                               ('missing','Compat.lua',None),
                               ('traversal',None,('../outside.lua',b''))]:
        bad=Path(directory)/(name+'.zip')
        with ZipFile(valid) as source,ZipFile(bad,'w') as target:
            for file in source.infolist():
                if not exclude or not file.filename.endswith('/'+exclude):target.writestr(file,source.read(file))
            if extra:target.writestr(*extra)
        try:module.validate(bad)
        except (ValueError,KeyError):pass
        else:raise AssertionError('Accepted invalid '+name+' package')
`],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
});
