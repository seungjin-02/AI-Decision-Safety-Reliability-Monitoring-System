import json
from pathlib import Path

FILES = ('index.html','app.js','entry.js','api-adapter.js','mock-adapter.js','display-contract.js','styles.css')

def inline_json(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False)
            .replace('&', '\\u0026').replace('<', '\\u003c').replace('>', '\\u003e')
            .replace('\u2028', '\\u2028').replace('\u2029', '\\u2029'))

def build(root=None, output=None):
    root=Path(root or Path(__file__).resolve().parent).resolve()
    output=Path(output or root/'dist').resolve()
    sources={name:(root/'src'/name).read_text(encoding='utf-8')
             for name in ('index.html','app.js','entry.js','api-adapter.js','mock-adapter.js','display-contract.mjs','styles.css')}
    response=json.loads((root/'fixtures/alerts.json').read_text(encoding='utf-8'))
    if not isinstance(response,dict) or not isinstance(response.get('alerts'),list):
        raise ValueError('fixtures/alerts.json must contain an alerts array')
    template=sources['index.html']
    if template.count('__ALERT_FIXTURES__')!=1:
        raise ValueError('src/index.html must contain exactly one __ALERT_FIXTURES__ marker')
    results={'index.html':template.replace('__ALERT_FIXTURES__',inline_json(response)),
             'display-contract.js':sources['display-contract.mjs'],
             'styles.css':sources['styles.css']}
    for name in ('app.js','entry.js','api-adapter.js','mock-adapter.js'):
        source=sources[name]
        if name!='entry.js' and source.count("'./display-contract.mjs'")!=1:
            raise ValueError(f'{name}: expected one explicit display-contract import')
        results[name]=source.replace("'./display-contract.mjs'","'./display-contract.js'")
    # Refuse to overwrite an unrelated path or silently retain old publishing assets.
    output.mkdir(parents=True,exist_ok=True)
    if output.is_symlink() or any(p.name not in FILES or not p.is_file() or p.is_symlink() for p in output.iterdir()):
        raise ValueError('Output contains unexpected files; choose a clean output directory')
    for name,text in results.items():
        (output/name).write_text(text,encoding='utf-8')
    print(f'Built {len(results)} runtime files in {output}')
    return output

if __name__=='__main__':
    build()
