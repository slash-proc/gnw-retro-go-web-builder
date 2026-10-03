"""Binding delegation and validation without a physical target."""
import unittest
from gnw_remote import HardwareSession


class Backend:
    def __init__(self):
        self.calls = []
    def open(self):
        self.calls.append(("open",))
    def close(self):
        self.calls.append(("close",))
    def read_uint32(self, addr):
        self.calls.append(("read_uint32", addr))
        return 0x12345678
    def read_memory(self, addr, size):
        self.calls.append(("read_memory", addr, size))
        return bytes(size)
    def write_memory(self, addr, data):
        self.calls.append(("write_memory", addr, data))
    def read_register(self, name):
        self.calls.append(("read_register", name))
        return 42
    def write_register(self, name, value):
        self.calls.append(("write_register", name, value))
    def set_frequency(self, hz):
        self.calls.append(("set_frequency", hz))


class HelperTests(unittest.TestCase):
    def setUp(self):
        self.backends = []
        def factory(hz):
            backend = Backend()
            self.backends.append(backend)
            return backend
        self.session = HardwareSession(1000000, factory)
        self.session.execute("attach", [])
    def tearDown(self):
        self.session.close()
    def test_live_delegation(self):
        self.assertEqual(self.session.execute("read_memory", [0x24000000, 4]), "78563412")
        self.assertEqual(self.session.execute("read_memory", [1, 3]), "000000")
        self.session.execute("write_memory", [0x24000000, "aabb"])
        self.assertEqual(self.session.execute("read_register", ["pc"]), 42)
        self.session.execute("write_register", ["msp", 0x20020000])
        self.session.execute("set_frequency", [500000])
        self.assertEqual([call[0] for call in self.backends[0].calls],
                         ["open", "read_uint32", "read_memory", "write_memory", "read_register", "write_register", "set_frequency"])
    def test_reconnect_owns_cleanup(self):
        self.session.execute("attach", [])
        self.assertEqual(self.backends[0].calls, [("open",), ("close",)])
        self.assertEqual(self.backends[1].calls, [("open",)])
    def test_validation(self):
        for method, args in [("read_memory", [-1, 4]), ("read_memory", [0, 65537]),
                             ("read_memory", [0xffffffff, 4]), ("write_register", ["pc", -1]),
                             ("read_register", ["unknown"]), ("set_frequency", [0]), ("eval", [])]:
            with self.subTest(method=method, args=args), self.assertRaises(ValueError):
                self.session.execute(method, args)
    def test_absent_target_retry(self):
        class Missing(Backend):
            def open(self):
                raise RuntimeError("target absent")
        missing = Missing()
        self.session.factory = lambda hz: missing
        with self.assertRaisesRegex(RuntimeError, "No device detected"):
            self.session.execute("attach", [])
        self.assertIsNone(self.session.backend)
        self.assertEqual(missing.calls, [("close",)])
        self.session.factory = lambda hz: Backend()
        self.assertTrue(self.session.execute("attach", []))


if __name__ == "__main__":
    unittest.main()
