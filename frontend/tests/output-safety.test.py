"""HTML interpretation regression, using only Python/Node standard libraries."""
import importlib.util
import json
import subprocess
import shutil
import uuid
import unittest
from html.parser import HTMLParser
from pathlib import Path

FRONT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('build_web',FRONT/'build_web.py')
builder=importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

class Parsed(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tags=[]
        self.text=[]
        self.scripts=[]
        self.in_script=False
    def handle_starttag(self,tag,attrs):
        self.tags.append((tag,dict(attrs)))
        if tag=='script':
            self.in_script=True
            self.scripts.append('')
    def handle_endtag(self,tag):
        if tag=='script':self.in_script=False
    def handle_data(self,data):
        self.text.append(data)
        if self.in_script:self.scripts[-1]+=data

class OutputSafety(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.case=json.loads(subprocess.check_output(['node',str(FRONT/'tests/output-cases.mjs')],text=True,encoding='utf-8'))
    def test_rendered_body_and_attributes_remain_text(self):
        parsed=Parsed()
        parsed.feed(self.case['html'])
        self.assertFalse(any(tag in ('img','script') for tag,_ in parsed.tags))
        self.assertFalse(any(key.startswith('on') or key=='data-injected' for _,attrs in parsed.tags for key in attrs))
        payload=self.case['payload']
        self.assertIn(payload,parsed.text)  # entity decoding preserves original text
        self.assertIn(('article',{'class':'inbox-row selected','aria-label':payload}),parsed.tags)
        buttons=[attrs for tag,attrs in parsed.tags if tag=='button' and 'data-select' in attrs]
        self.assertEqual(buttons[0]['aria-label'],payload+' 상세 보기')
        self.assertGreaterEqual(parsed.text.count(payload),7)  # ids, raw reasons, evidence and action code
    def test_script_json_preserves_values_without_terminating_script(self):
        response=json.loads((FRONT/'fixtures/alerts.json').read_text(encoding='utf-8'))
        response['alerts'][0]['event_id']='</script><img data-injected="yes">&\u2028\u2029'
        serialized=builder.inline_json(response)
        parsed=Parsed()
        parsed.feed('<script type="application/json">'+serialized+'</script><div id="after"></div>')
        self.assertEqual(len(parsed.scripts),1)
        self.assertFalse(any(tag=='img' for tag,_ in parsed.tags))
        self.assertIn(('div',{'id':'after'}),parsed.tags)
        self.assertEqual(json.loads(parsed.scripts[0]),response)
    def test_source_only_build_and_explicit_failures(self):
        # Dist is absent in this root; sources and fixtures alone must reproduce it.
        temporary_parent=(FRONT/'dist').resolve()
        temporary_parent.mkdir(exist_ok=True)
        # Inherit workspace permissions instead of mkdtemp's restrictive mode.
        root=(temporary_parent/('build-check-'+uuid.uuid4().hex)).resolve()
        self.assertEqual(root.parent,temporary_parent)
        root.mkdir()
        try:
            (root/'src').mkdir()
            (root/'fixtures').mkdir()
            for source in (FRONT/'src').iterdir():
                (root/'src'/source.name).write_bytes(source.read_bytes())
            (root/'fixtures/alerts.json').write_bytes((FRONT/'fixtures/alerts.json').read_bytes())
            result=builder.build(root)
            self.assertEqual({p.name for p in result.iterdir()},set(builder.FILES))
            self.assertIn("'./display-contract.js'",(result/'app.js').read_text(encoding='utf-8'))
            (root/'src/index.html').write_text('no marker',encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'exactly one'):builder.build(root)
            (root/'src/index.html').unlink()
            with self.assertRaises(FileNotFoundError):builder.build(root)
        finally:
            self.assertEqual(root.parent,temporary_parent)
            self.assertFalse(root.is_symlink())
            shutil.rmtree(root)

if __name__=='__main__':
    unittest.main()
