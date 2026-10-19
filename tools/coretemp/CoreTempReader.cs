// Reads Core Temp's shared memory for CPU Meter Modern. JScript can't open a file mapping, so the
// gadget creates this class through COM (registered per-user by coretemp.js, no admin needed).
// Built by build.ps1 with the csc.exe of .NET Framework 4, which every Windows 10/11 has.
//
// Layout of the mapping (https://www.alcpu.com/CoreTemp/developers.html), 4-byte aligned:
//   uint  uiLoad[256]      @0
//   uint  uiTjMax[128]     @1024
//   uint  uiCoreCnt        @1536
//   uint  uiCPUCnt         @1540
//   float fTemp[256]       @1544
//   float fVID, fCPUSpeed, fFSBSpeed, fMultiplier   @2568
//   char  sCPUName[100]    @2584
//   uchar ucFahrenheit     @2684
//   uchar ucDeltaToTjMax   @2685

using System;
using System.IO.MemoryMappedFiles;
using System.Reflection;
using System.Runtime.InteropServices;

[assembly: AssemblyTitle("Modern Meters Core Temp reader")]
[assembly: AssemblyVersion("1.0.0.0")]

namespace ModernMeters
{
    [ComVisible(true)]
    [Guid("5b0f6f5e-3c1d-4a7e-9a52-8d3c6e1f2a47")]
    [ProgId("ModernMeters.CoreTempReader")]
    [ClassInterface(ClassInterfaceType.AutoDispatch)]
    public class CoreTempReader
    {
        const int Size = 2686;
        static readonly string[] Names = { "CoreTempMappingObject", "CoreTempMappingObjectEx" };
        byte[] data;

        // Takes a fresh copy of the shared memory; false while Core Temp isn't running
        public bool Refresh()
        {
            foreach (string name in Names)
            {
                try
                {
                    using (var map = MemoryMappedFile.OpenExisting(name, MemoryMappedFileRights.Read))
                    using (var view = map.CreateViewAccessor(0, Size, MemoryMappedFileAccess.Read))
                    {
                        var buf = new byte[Size];
                        view.ReadArray(0, buf, 0, Size);
                        data = buf;
                        return true;
                    }
                }
                catch (Exception)
                {
                }
            }
            data = null;
            return false;
        }

        public int CoreCount
        {
            get { return data == null ? 0 : (int)(UInt(1536) * UInt(1540)); }
        }

        public bool Fahrenheit
        {
            get { return data != null && data[2684] != 0; }
        }

        // Temperature of core i counted across all CPUs, in Core Temp's display unit; 0 when unknown
        public double GetTemp(int i)
        {
            if (data == null || i < 0 || i >= CoreCount || i >= 256) return 0;
            double t = BitConverter.ToSingle(data, 1544 + 4 * i);
            if (data[2685] == 0) return t;
            // Core Temp is set to show the distance to TjMax instead of the temperature
            uint perCpu = UInt(1536);
            double tjMax = UInt(1024 + 4 * (int)(i / perCpu));
            if (Fahrenheit) tjMax = tjMax * 9 / 5 + 32;
            return tjMax - t;
        }

        public int GetLoad(int i)
        {
            return data == null || i < 0 || i >= 256 ? 0 : (int)UInt(4 * i);
        }

        uint UInt(int offset)
        {
            return BitConverter.ToUInt32(data, offset);
        }
    }
}
