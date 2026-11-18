import os, sys, json, tempfile, unittest
from pathlib import Path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import upload_poll as up


class Sanitise(unittest.TestCase):
    def test_keeps_normal_name(self):
        self.assertEqual(up.sanitise("La Mirada 2026-11-18 1430.mov"), "La Mirada 2026-11-18 1430.mov")

    def test_strips_paths_and_controls(self):
        self.assertEqual(up.sanitise("../../etc/passwd"), "passwd")
        self.assertEqual(up.sanitise("a\\b\\c.jpg"), "c.jpg")
        self.assertEqual(up.sanitise("x\x00y\n.mov"), "xy.mov")
        self.assertEqual(up.sanitise("..hidden.jpg"), "hidden.jpg")

    def test_empty_and_long(self):
        self.assertEqual(up.sanitise("///"), "unnamed")
        self.assertEqual(up.sanitise(None), "unnamed")
        n = up.sanitise("a" * 400 + ".mov")
        self.assertLessEqual(len(n), 150)
        self.assertTrue(n.endswith(".mov"))


class Collision(unittest.TestCase):
    def test_numbering(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(up.unique_path(d, "a.mov").name, "a.mov")
            Path(d, "a.mov").write_text("x")
            self.assertEqual(up.unique_path(d, "a.mov").name, "a-2.mov")
            Path(d, "a-2.mov").write_text("x")
            self.assertEqual(up.unique_path(d, "a.mov").name, "a-3.mov")
            Path(d, "noext").write_text("x")
            self.assertEqual(up.unique_path(d, "noext").name, "noext-2")


class SizeCheck(unittest.TestCase):
    def test_size(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d, "f"); p.write_bytes(b"12345")
            self.assertTrue(up.size_ok(p, 5))
            self.assertFalse(up.size_ok(p, 4))
            self.assertFalse(up.size_ok(p, "5"))
            self.assertFalse(up.size_ok(p, None))
            self.assertFalse(up.size_ok(p, True))
            self.assertFalse(up.size_ok(Path(d, "missing"), 0))

    def test_existing_copy(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, "a.mov").write_bytes(b"123")
            Path(d, "a-2.mov").write_bytes(b"12345")
            self.assertEqual(up.existing_copy(d, "a.mov", 3).name, "a.mov")
            self.assertEqual(up.existing_copy(d, "a.mov", 5).name, "a-2.mov")
            self.assertIsNone(up.existing_copy(d, "a.mov", 9))


class AirState(unittest.TestCase):
    def test_missing_and_state_file(self):
        with tempfile.TemporaryDirectory() as d:
            for kind, name in [("video", "v1.mov"), ("video", "v2.mov"), ("receipt", "r1.jpg")]:
                (Path(d) / kind).mkdir(exist_ok=True)
                (Path(d) / kind / name).write_text("x")
            (Path(d) / "video" / ".hidden").write_text("x")
            (Path(d) / "video" / "x.part").write_text("x")
            keys = up.archive_keys(d)
            self.assertEqual(keys, ["video/v1.mov", "video/v2.mov", "receipt/r1.jpg"])
            st = Path(d) / "air_synced.json"
            self.assertEqual(up.load_synced(st), [])  # missing file
            up.save_synced(st, ["video/v1.mov", "gone/old.mov"])
            self.assertEqual(up.air_missing(keys, up.load_synced(st)), ["video/v2.mov", "receipt/r1.jpg"])
            st.write_text("not json")
            self.assertEqual(up.load_synced(st), [])  # corrupt state: resend everything, never crash
            self.assertEqual(up.air_missing(keys, []), keys)


if __name__ == "__main__":
    unittest.main()
