// Reads a graphics card's temperature, fan, power and clocks for GPU Meter Modern through
// D3DKMTQueryAdapterInfo, the same vendor-neutral source Task Manager uses (WDDM 2.4+,
// Windows 10 1803 and later). gpuhelper.js creates this class through COM; coretemp-style
// per-user registration is done by the gadget, so no admin rights are needed.
// Built by build.ps1 with the csc.exe of .NET Framework 4, which every Windows 10/11 has.
//
// Structures (d3dkmthk.h), read from raw buffers to keep the layout explicit:
//   D3DKMT_ADAPTER_PERFDATA      (type 62, 64 bytes): MemoryFrequency Hz @8, FanRPM @48,
//                                 Power in 0.1 % @52, Temperature in 0.1 °C @56
//   D3DKMT_ADAPTER_PERFDATACAPS  (type 63, 40 bytes): MaxFanRPM @24, TemperatureMax @28
//   D3DKMT_NODE_PERFDATA         (type 61, 56 bytes): NodeOrdinal @0 (in), Frequency Hz @8,
//                                 MaxFrequency Hz @16

using System;
using System.Reflection;
using System.Runtime.InteropServices;

[assembly: AssemblyTitle("Modern Meters GPU reader")]
[assembly: AssemblyVersion("1.0.0.0")]

namespace ModernMeters
{
    [ComVisible(true)]
    [Guid("8c41d7a2-6f0e-4b9d-b3a5-2e7f19c4d860")]
    [ProgId("ModernMeters.GpuReader")]
    [ClassInterface(ClassInterfaceType.AutoDispatch)]
    public class GpuReader
    {
        [StructLayout(LayoutKind.Sequential)]
        struct OpenFromLuid { public uint Low; public int High; public uint Adapter; }

        [StructLayout(LayoutKind.Sequential)]
        struct QueryInfo { public uint Adapter; public int Type; public IntPtr Data; public uint Size; }

        [DllImport("gdi32.dll")] static extern int D3DKMTOpenAdapterFromLuid(ref OpenFromLuid p);
        [DllImport("gdi32.dll")] static extern int D3DKMTQueryAdapterInfo(ref QueryInfo p);
        [DllImport("gdi32.dll")] static extern int D3DKMTCloseAdapter(ref uint adapter);

        const int NodePerf = 61, AdapterPerf = 62, AdapterCaps = 63, MaxNodes = 16;

        uint adapter;
        int node = -1;

        // -1 (or 0 for clocks) means the driver doesn't report it
        public double Temperature { get; private set; }
        public double PowerPct { get; private set; }
        public double FanRpm { get; private set; }
        public double FanPct { get; private set; }
        public double MaxFanRpm { get; private set; }
        public double CoreMHz { get; private set; }
        public double MaxCoreMHz { get; private set; }
        public double MemMHz { get; private set; }

        public GpuReader()
        {
            Temperature = PowerPct = FanRpm = FanPct = -1;
        }

        // luid: "hhhhhhhh_llllllll" as in the GPU performance counter instance names
        public bool Open(string luid)
        {
            Close();
            string[] parts = luid.Replace("0x", "").Split('_');
            if (parts.Length != 2) return false;
            var p = new OpenFromLuid
            {
                High = (int)Convert.ToUInt32(parts[0], 16),
                Low = Convert.ToUInt32(parts[1], 16)
            };
            if (D3DKMTOpenAdapterFromLuid(ref p) != 0) return false;
            adapter = p.Adapter;

            byte[] caps = Query(AdapterCaps, 40, 0);
            if (caps != null) MaxFanRpm = BitConverter.ToUInt32(caps, 24);

            // The node with the highest clock is the 3D engine
            double best = 0;
            for (int i = 0; i < MaxNodes; i++)
            {
                byte[] n = Query(NodePerf, 56, (uint)i);
                if (n == null) break;
                double max = BitConverter.ToUInt64(n, 16) / 1e6;
                if (max > best) { best = max; node = i; }
            }
            MaxCoreMHz = best;
            return true;
        }

        public bool Refresh()
        {
            if (adapter == 0) return false;
            byte[] a = Query(AdapterPerf, 64, 0);
            if (a == null) return false;
            MemMHz = BitConverter.ToUInt64(a, 8) / 1e6;
            FanRpm = BitConverter.ToUInt32(a, 48);
            PowerPct = BitConverter.ToUInt32(a, 52) / 10.0;
            Temperature = BitConverter.ToUInt32(a, 56) / 10.0;
            // Zero from a card that never reports it is "unknown", not "0 °C"
            if (Temperature <= 0) Temperature = -1;
            if (PowerPct <= 0) PowerPct = -1;
            if (MaxFanRpm <= 0 && FanRpm <= 0) FanRpm = -1;
            FanPct = MaxFanRpm > 0 && FanRpm >= 0 ? Math.Min(100, FanRpm / MaxFanRpm * 100) : -1;
            if (node >= 0)
            {
                byte[] n = Query(NodePerf, 56, (uint)node);
                if (n != null) CoreMHz = BitConverter.ToUInt64(n, 8) / 1e6;
            }
            return true;
        }

        public void Close()
        {
            if (adapter != 0) { uint h = adapter; D3DKMTCloseAdapter(ref h); }
            adapter = 0;
            node = -1;
        }

        // first: the structure's first UINT (node ordinal or physical adapter index)
        byte[] Query(int type, int size, uint first)
        {
            IntPtr buf = Marshal.AllocHGlobal(size);
            try
            {
                for (int i = 0; i < size; i++) Marshal.WriteByte(buf, i, 0);
                Marshal.WriteInt32(buf, 0, (int)first);
                var q = new QueryInfo { Adapter = adapter, Type = type, Data = buf, Size = (uint)size };
                if (D3DKMTQueryAdapterInfo(ref q) != 0) return null;
                var result = new byte[size];
                Marshal.Copy(buf, result, 0, size);
                return result;
            }
            finally
            {
                Marshal.FreeHGlobal(buf);
            }
        }
    }
}
