// Draws the images that depend on the chosen colors, on the user's machine and only when a gadget
// needs them: panel backgrounds for the colored glass and light themes and the GPU ring gauges in
// their colors. Bundling them all would take ~5 MB per theme and accent. The gadget creates this
// class through COM (registered per-user by common.js, no admin needed) and caches the PNGs in its
// img\gen folder. Built by build.ps1 with the csc.exe of .NET Framework 4.
//
// The drawing matches tools/make-images.ps1, which renders the bundled classic and navy glass sets.

using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;

[assembly: AssemblyTitle("Modern Meters panel painter")]
[assembly: AssemblyVersion("1.0.0.0")]

namespace ModernMeters
{
    [ComVisible(true)]
    [Guid("8e3c2a71-5d4b-4f19-b6a0-2c7e9f41d385")]
    [ProgId("ModernMeters.PanelPainter")]
    [ClassInterface(ClassInterfaceType.AutoDispatch)]
    public class PanelPainter
    {
        const int K = 2;   // drawn at 2x so the Sidebar's high-DPI scaling stays crisp

        static Color Parse(string hex)
        {
            return Color.FromArgb(int.Parse(hex.TrimStart('#'), NumberStyles.HexNumber) | unchecked((int)0xFF000000));
        }

        static GraphicsPath Round(float x, float y, float w, float h, float r)
        {
            var p = new GraphicsPath();
            float d = 2 * r;
            p.AddArc(x, y, d, d, 180, 90);
            p.AddArc(x + w - d, y, d, d, 270, 90);
            p.AddArc(x + w - d, y + h - d, d, d, 0, 90);
            p.AddArc(x, y + h - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        static void Save(Bitmap bmp, string path)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            // Written under another name first so a gadget never loads a half-written file
            string tmp = path + ".tmp";
            bmp.Save(tmp, ImageFormat.Png);
            if (File.Exists(path)) File.Delete(path);
            File.Move(tmp, path);
        }

        // Glass panel w x h: vertical gradient top -> bottom over gradH px then flat, white gloss
        // over the top 70px, and a 4px border of edge color whose alpha goes glow[0] (outside) to
        // glow[3] ("230,90,45,20"). gloss: alpha of the gloss at its top (0 for none).
        public bool Glass(string path, int w, int h, string top, string bottom, int gradH, string edge, string glow, int gloss)
        {
            try
            {
                int W2 = w * K, H2 = h * K;
                string[] alphas = glow.Split(',');
                using (var bmp = new Bitmap(W2, H2))
                using (var g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.Clear(Color.Transparent);
                    using (var path0 = Round(0, 0, W2, H2, 12 * K))
                    {
                        g.FillPath(new SolidBrush(Parse(bottom)), path0);
                        g.SetClip(path0);
                        int gh = Math.Min(gradH, h) * K;
                        using (var grad = new LinearGradientBrush(new Rectangle(0, 0, W2, gh), Parse(top), Parse(bottom), 90))
                            g.FillRectangle(grad, 0, 0, W2, gh - 1);
                        if (gloss > 0)
                        {
                            using (var gl = new LinearGradientBrush(new Rectangle(0, 4 * K, W2, 70 * K),
                                Color.FromArgb(gloss, 255, 255, 255), Color.FromArgb(0, 255, 255, 255), 90))
                                // A little short of the brush, which would otherwise wrap around to its start color
                                g.FillRectangle(gl, 0, 4 * K, W2, 70 * K - 2);
                        }
                        g.ResetClip();
                    }
                    Color e = Parse(edge);
                    for (int i = 0; i < alphas.Length; i++)
                    {
                        float o = i * K + K / 2f;
                        using (var pen = new Pen(Color.FromArgb(int.Parse(alphas[i].Trim()), e), K))
                        using (var rp = Round(o, o, W2 - 2 * o, H2 - 2 * o, (12 - i) * K))
                            g.DrawPath(pen, rp);
                    }
                    Save(bmp, path);
                }
                return true;
            }
            catch
            {
                return false;
            }
        }

        // Ring gauge strip like make-images.ps1's Save-Gauges: 51 frames of 52px (drawn at 2x)
        // stacked vertically for 0..100% in 2% steps, ring of color over a track ring
        public bool Gauge(string path, string color, string track)
        {
            try
            {
                const int n = 104;
                Color c = Parse(color);
                using (var bmp = new Bitmap(n, n * 51))
                using (var g = Graphics.FromImage(bmp))
                using (var trackPen = new Pen(Parse(track), 8))
                using (var glowPen = new Pen(Color.FromArgb(45, c), 15))
                using (var arc = new Pen(c, 8))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.Clear(Color.Transparent);
                    foreach (var p in new[] { trackPen, glowPen, arc }) { p.StartCap = LineCap.Round; p.EndCap = LineCap.Round; }
                    for (int f = 0; f <= 50; f++)
                    {
                        int y = f * n;
                        g.DrawArc(trackPen, 10, y + 10, n - 20, n - 20, 135, 270);
                        if (f == 0) continue;
                        g.DrawArc(glowPen, 10, y + 10, n - 20, n - 20, 135, 270f * f / 50);
                        g.DrawArc(arc, 10, y + 10, n - 20, n - 20, 135, 270f * f / 50);
                    }
                    Save(bmp, path);
                }
                return true;
            }
            catch
            {
                return false;
            }
        }
    }
}
