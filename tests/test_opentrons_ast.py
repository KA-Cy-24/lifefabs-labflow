"""Offline assertions for the allowlisted reader. No Opentrons package required."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'parsers'))
from opentrons_ast import analyse

ORDER = {'plate': [['A1','B1'], ['A2','B2']], 'tips': [['A1','B1']]}
PROTOCOL = '''
requirements = {'robotType': 'OT-2', 'apiLevel': '2.15'}
def run(ctx: protocol_api.ProtocolContext):
    robot = ctx
    plate = robot.load_labware('plate', 2)
    racks = [ctx.load_labware('tips', slot) for slot in [4, 5]]
    pip = ctx.load_instrument('p300_single_gen2', mount='right', tip_racks=racks)
    for a, b in zip(plate.rows()[0], plate.rows()[1]):
        pip.pick_up_tip()
        pip.aspirate(40, a.bottom(z=1))
        pip.dispense(40, b.top(z=-2))
        pip.drop_tip()
'''


class ParserTests(unittest.TestCase):
    def test_rename_and_symbolic_expansion(self):
        for name in ('ctx','protocol','robot_context'):
            x = analyse(PROTOCOL.replace('ctx',name), ORDER)
            self.assertEqual(x['parameter'],name)
            self.assertEqual([h['location'] for h in x['hardware']], [2,4,5,'right'])
            self.assertEqual(len(x['events']),8)
            self.assertEqual(x['events'][6]['targets'][0]['well'],'B2')
            self.assertEqual(x['events'][6]['targets'][0]['z'],-2)

    def test_unknown_branch_stops_not_flattens(self):
        x = analyse(PROTOCOL + '    if ctx.params.flag:\n        pip.drop_tip()\n    else:\n        pip.pick_up_tip()\n', ORDER)
        self.assertEqual(len(x['events']),8)
        self.assertIn('Runtime-dependent branch',x['warnings'][-1]['message'])

    def test_never_runs_input(self):
        x = analyse('raise RuntimeError("executed")\ndef run(ctx):\n    exec("raise RuntimeError()")')
        self.assertFalse(x['events'])
        self.assertEqual(x['status'],'partial')

    def test_flex(self):
        x = analyse(PROTOCOL.replace('OT-2','Flex'), ORDER)
        self.assertEqual(x['status'],'source-only')
        self.assertFalse(x['hardware'])

    def test_complex_command_preserves_groups(self):
        x = analyse(PROTOCOL + '    pip.distribute(20, plate["A1"], [plate["B1"], plate["B2"]])\n', ORDER)
        e = x['events'][-1]
        self.assertEqual(e['method'],'distribute')
        self.assertEqual([t['well'] for t in e['targets'][1]], ['B1','B2'])

    def test_missing_library_values_do_not_invent_mount(self):
        x = analyse(PROTOCOL.replace("    robot = ctx", '    [mount] = get_values("mount")\n    robot = ctx').replace("mount='right'",'mount=mount'),ORDER)
        self.assertIsNone(x['hardware'][-1]['location'])
        self.assertEqual(len(x['events']),8)
        self.assertEqual(x['status'],'partial')

    def test_explicit_definition_identity_not_substituted(self):
        x = analyse(PROTOCOL.replace("'plate', 2)","'plate', 2, namespace='custom', version=7)"),ORDER)
        self.assertEqual(x['status'],'partial')
        self.assertFalse(x['hardware'][0]['catalogue'])
        self.assertFalse(x['events'])

    def test_offset_is_not_exact_position(self):
        x = analyse(PROTOCOL.replace('a.bottom(z=1)','a.bottom(z=1).move(Point(x=-2))'), ORDER)
        self.assertTrue(x['events'][1]['targets'][0]['offset'])


if __name__ == '__main__':
    unittest.main()
