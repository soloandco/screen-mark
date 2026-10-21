"""Read Windows process memory without reading process contents or browser profiles."""
import ctypes
import json
import sys
from ctypes import wintypes


class MemoryCounters(ctypes.Structure):
    _fields_ = [
        ('cb', wintypes.DWORD), ('PageFaultCount', wintypes.DWORD),
        ('PeakWorkingSetSize', ctypes.c_size_t), ('WorkingSetSize', ctypes.c_size_t),
        ('QuotaPeakPagedPoolUsage', ctypes.c_size_t), ('QuotaPagedPoolUsage', ctypes.c_size_t),
        ('QuotaPeakNonPagedPoolUsage', ctypes.c_size_t), ('QuotaNonPagedPoolUsage', ctypes.c_size_t),
        ('PagefileUsage', ctypes.c_size_t), ('PeakPagefileUsage', ctypes.c_size_t),
        ('PrivateUsage', ctypes.c_size_t), ('PrivateWorkingSetSize', ctypes.c_size_t),
        ('SharedCommitUsage', ctypes.c_uint64),
    ]


kernel = ctypes.WinDLL('kernel32', use_last_error=True)
psapi = ctypes.WinDLL('psapi', use_last_error=True)
kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
kernel.OpenProcess.restype = wintypes.HANDLE
kernel.CloseHandle.argtypes = [wintypes.HANDLE]
psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(MemoryCounters), wintypes.DWORD]
psapi.GetProcessMemoryInfo.restype = wintypes.BOOL

for line in sys.stdin:
    try:
        request = json.loads(line)
        processes = []
        for process in request['processes']:
            handle = kernel.OpenProcess(0x0400 | 0x0010, False, int(process['id']))
            if not handle:
                processes.append({**process, 'error': ctypes.get_last_error()})
                continue
            try:
                counters = MemoryCounters()
                counters.cb = ctypes.sizeof(counters)
                if not psapi.GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb):
                    processes.append({**process, 'error': ctypes.get_last_error()})
                    continue
                processes.append({
                    **process,
                    'privateWorkingSetBytes': counters.PrivateWorkingSetSize,
                    'privateCommitBytes': counters.PrivateUsage,
                    'workingSetBytes': counters.WorkingSetSize,
                })
            finally:
                kernel.CloseHandle(handle)
        print(json.dumps({'id': request['id'], 'processes': processes}), flush=True)
    except Exception as error:
        print(json.dumps({'error': str(error)}), flush=True)
