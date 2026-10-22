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

        // Whole panels drawn as one picture, for the themes whose look the gadget's own pieces
        // can't build: "aero" (Windows 7: blue glass, a curved gloss, diagonal light streaks, a dark
        // outer and light inner edge) and "liquid" (Apple's Liquid Glass: frosted light glass with
        // a large radius, a bright rim along the top and a soft darker one along the bottom).
        public bool Art(string path, int w, int h, string style, string top, string bottom)
        {
            try
            {
                int W2 = w * K, H2 = h * K;
                bool aero = style == "aero";
                float r = (aero ? 8 : 20) * K;
                using (var bmp = new Bitmap(W2, H2))
                using (var g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.Clear(Color.Transparent);
                    using (var shape = Round(0, 0, W2, H2, r))
                    {
                        g.SetClip(shape);
                        int gh = Math.Min(H2, 300 * K);
                        using (var grad = new LinearGradientBrush(new Rectangle(0, 0, W2, gh), Parse(top), Parse(bottom), 90))
                        {
                            g.FillRectangle(new SolidBrush(Parse(bottom)), 0, 0, W2, H2);
                            g.FillRectangle(grad, 0, 0, W2, gh - 1);
                        }
                        g.ResetClip();
                    }
                    if (aero) AeroDecor(g, W2, H2, r);
                    else LiquidRim(g, W2, H2, r);
                    Save(bmp, path);
                }
                return true;
            }
            catch
            {
                return false;
            }
        }

        // Windows 7 Aero over whatever fills W2 x H2: a gloss hanging over the top with a curved
        // lower edge, streaks of light leaning right, a light inner and dark outer edge
        static void AeroDecor(Graphics g, int W2, int H2, float r)
        {
            using (var clip = Round(0, 0, W2, H2, r))
            {
                g.SetClip(clip);
                int eh = Math.Min(H2, 150 * K);
                var gloss = new RectangleF(-W2 * 0.35f, -eh * 0.75f, W2 * 1.7f, eh * 1.25f);
                using (var gb = new LinearGradientBrush(new RectangleF(0, 0, W2, eh * 0.5f + 1),
                    Color.FromArgb(46, 255, 255, 255), Color.FromArgb(10, 255, 255, 255), 90))
                    g.FillEllipse(gb, gloss);
                float lean = H2 * 0.45f;
                Streak(g, W2 * 0.18f, 16 * K, lean, H2, 24);
                Streak(g, W2 * 0.18f + 22 * K, 6 * K, lean, H2, 16);
                Streak(g, W2 * 0.62f, 10 * K, lean, H2, 12);
                g.ResetClip();
            }
            using (var inner = Round(K * 1.5f, K * 1.5f, W2 - 3 * K, H2 - 3 * K, r - K))
            using (var pen = new Pen(Color.FromArgb(120, 255, 255, 255), K))
                g.DrawPath(pen, inner);
            using (var outer = Round(K / 2f, K / 2f, W2 - K, H2 - K, r))
            using (var pen = new Pen(Color.FromArgb(220, 8, 24, 44), K))
                g.DrawPath(pen, outer);
        }

        // Liquid Glass over whatever fills W2 x H2: a soft sheen over the top, a lens of light along
        // the edges, a specular rim brightest at the top left, and a faint shade rising to the bottom
        static void LiquidRim(Graphics g, int W2, int H2, float r)
        {
            int sh = Math.Min(H2, 120 * K);
            using (var clip = Round(0, 0, W2, H2, r))
            {
                g.SetClip(clip);
                using (var sb = new LinearGradientBrush(new Rectangle(0, 0, W2, sh), Color.FromArgb(110, 255, 255, 255), Color.FromArgb(0, 255, 255, 255), 90))
                    g.FillRectangle(sb, 0, 0, W2, sh - 1);
                g.ResetClip();
            }
            // A fine edge: a thin lens just inside a one-pixel rim
            using (var lens = Round(2.25f * K, 2.25f * K, W2 - 4.5f * K, H2 - 4.5f * K, r - 2.25f * K))
            using (var pen = new Pen(Color.FromArgb(55, 255, 255, 255), 1.5f * K))
                g.DrawPath(pen, lens);
            using (var rim = Round(K, K, W2 - 2 * K, H2 - 2 * K, r - K))
            {
                using (var lb = new LinearGradientBrush(new Rectangle(0, 0, W2, H2), Color.FromArgb(230, 255, 255, 255), Color.FromArgb(30, 255, 255, 255), 60))
                using (var pen = new Pen(lb, K))
                    g.DrawPath(pen, rim);
                using (var db = new LinearGradientBrush(new Rectangle(0, 0, W2, H2), Color.FromArgb(0, 0, 0, 0), Color.FromArgb(40, 0, 0, 0), 90))
                using (var pen = new Pen(db, K))
                    g.DrawPath(pen, rim);
            }
            using (var outer = Round(K / 2f, K / 2f, W2 - K, H2 - K, r))
            using (var pen = new Pen(Color.FromArgb(46, 0, 0, 0), K))
                g.DrawPath(pen, outer);
        }

        // The wallpaper, loaded once for all the gadgets: they run on threads of their own, and a
        // GDI+ bitmap must not be read by two at a time
        static Bitmap wallBitmap;
        static string wallKey;
        static readonly object wallLock = new object();

        // The part of the wallpaper under a gadget at x, y (logical px), w x h, shrunk to bw x bh
        // (drawn back up, that blurs it). The screen is sw x sh physical px, scale physical px per
        // logical one. wallStyle as in the registry: 0 center, 1 tile, 2 stretch, 6 fit, 10 fill,
        // 22 span.
        static Bitmap Under(string wallpaper, int wallStyle, int sw, int sh, int x, int y, int w, int h,
            double scale, int bw, int bh)
        {
            lock (wallLock) return UnderLocked(wallpaper, wallStyle, sw, sh, x, y, w, h, scale, bw, bh);
        }

        static Bitmap UnderLocked(string wallpaper, int wallStyle, int sw, int sh, int x, int y, int w, int h,
            double scale, int bw, int bh)
        {
            string key = wallpaper + "|" + File.GetLastWriteTimeUtc(wallpaper).Ticks;
            if (key != wallKey)
            {
                if (wallBitmap != null) wallBitmap.Dispose();
                using (var fs = new FileStream(wallpaper, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                using (var img = Image.FromStream(fs))
                    wallBitmap = new Bitmap(img);
                wallKey = key;
            }
            var wp = wallBitmap;
            // Where the picture lies on the screen
            RectangleF d;
            if (wallStyle == 2) d = new RectangleF(0, 0, sw, sh);
            else if (wallStyle == 0) d = new RectangleF((sw - wp.Width) / 2f, (sh - wp.Height) / 2f, wp.Width, wp.Height);
            else
            {
                float k = wallStyle == 6 ? Math.Min((float)sw / wp.Width, (float)sh / wp.Height) : Math.Max((float)sw / wp.Width, (float)sh / wp.Height);
                d = new RectangleF((sw - wp.Width * k) / 2f, (sh - wp.Height * k) / 2f, wp.Width * k, wp.Height * k);
            }
            // The gadget's rectangle in picture pixels
            float px = (float)(x * scale), py = (float)(y * scale), pw = (float)(w * scale), ph = (float)(h * scale);
            var src = new RectangleF((px - d.X) * wp.Width / d.Width, (py - d.Y) * wp.Height / d.Height,
                pw * wp.Width / d.Width, ph * wp.Height / d.Height);
            var small = new Bitmap(bw, bh);
            using (var gs = Graphics.FromImage(small))
            {
                gs.Clear(Color.Black);
                gs.InterpolationMode = InterpolationMode.HighQualityBilinear;
                gs.DrawImage(wp, new Rectangle(0, 0, bw, bh), src, GraphicsUnit.Pixel);
            }
            return small;
        }

        // Average brightness (0..255) of the wallpaper under a gadget, -1 if it can't be read:
        // decides between light and dark glass
        public int Luma(string wallpaper, int wallStyle, int sw, int sh, int x, int y, int w, int h, double scale)
        {
            try
            {
                using (var small = Under(wallpaper, wallStyle, sw, sh, x, y, w, h, scale, 16, Math.Max(4, h / 10)))
                {
                    double sum = 0;
                    for (int j = 0; j < small.Height; j++)
                        for (int i = 0; i < small.Width; i++)
                        {
                            Color c = small.GetPixel(i, j);
                            sum += 0.2126 * c.R + 0.7152 * c.G + 0.0722 * c.B;
                        }
                    return (int)(sum / (small.Width * small.Height));
                }
            }
            catch
            {
                return -1;
            }
        }

        // Frosted glass: the wallpaper under the gadget (see Under), blurred and washed with tint
        // (alpha 0..255), under the edges of style: "liquid" (LiquidRim) or "aero" (AeroDecor)
        public bool Frost(string path, int w, int h, string wallpaper, int wallStyle, int sw, int sh,
            int x, int y, double scale, string tint, int alpha, string style)
        {
            try
            {
                int W2 = w * K, H2 = h * K;
                bool aero = style == "aero";
                float r = (aero ? 8 : 20) * K;
                // Blur: down to a sixth and back up, smoothly
                int bw = Math.Max(4, w / 6), bh = Math.Max(4, h / 6);
                using (var small = Under(wallpaper, wallStyle, sw, sh, x, y, w, h, scale, bw, bh))
                using (var bmp = new Bitmap(W2, H2))
                using (var g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.Clear(Color.Transparent);
                    using (var shape = Round(0, 0, W2, H2, r))
                    {
                        g.SetClip(shape);
                        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                        using (var ia = new ImageAttributes())
                        {
                            ia.SetWrapMode(WrapMode.TileFlipXY);
                            g.DrawImage(small, new Rectangle(0, 0, W2, H2), 0, 0, bw, bh, GraphicsUnit.Pixel, ia);
                        }
                        using (var wash = new SolidBrush(Color.FromArgb(alpha, Parse(tint))))
                            g.FillRectangle(wash, 0, 0, W2, H2);
                        g.ResetClip();
                    }
                    if (aero) AeroDecor(g, W2, H2, r);
                    else LiquidRim(g, W2, H2, r);
                    Save(bmp, path);
                }
                return true;
            }
            catch
            {
                return false;
            }
        }

        // A band of white (alpha a) from x at the top to x + lean at the bottom, w wide
        static void Streak(Graphics g, float x, float w, float lean, int h, int a)
        {
            using (var b = new SolidBrush(Color.FromArgb(a, 255, 255, 255)))
                g.FillPolygon(b, new[] { new PointF(x, 0), new PointF(x + w, 0), new PointF(x + w + lean, h), new PointF(x + lean, h) });
        }

        // A square Windows 95/98 window frame: a raised bevel, light above and left, dark below
        // and right, two lines deep, around a flat face
        public bool Bevel(string path, int w, int h, string face)
        {
            try
            {
                using (var bmp = new Bitmap(w * K, h * K))
                using (var g = Graphics.FromImage(bmp))
                {
                    g.Clear(Parse(face));
                    // outer and inner line: [top-left, bottom-right]
                    string[][] lines = { new[] { "#dfdfdf", "#000000" }, new[] { "#ffffff", "#808080" } };
                    for (int i = 0; i < 2; i++)
                    {
                        int o = i * K, r = w * K - o - K, b = h * K - o - K;
                        using (var light = new SolidBrush(Parse(lines[i][0])))
                        using (var dark = new SolidBrush(Parse(lines[i][1])))
                        {
                            g.FillRectangle(light, o, o, r - o, K);
                            g.FillRectangle(light, o, o, K, b - o);
                            g.FillRectangle(dark, o, b, r - o + K, K);
                            g.FillRectangle(dark, r, o, K, b - o + K);
                        }
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

        // The image at src with its colors scaled by factor (below 1: darker), alpha kept
        public bool Shade(string src, string path, double factor)
        {
            try
            {
                using (var from = new Bitmap(src))
                using (var bmp = new Bitmap(from.Width, from.Height))
                {
                    for (int y = 0; y < from.Height; y++)
                        for (int x = 0; x < from.Width; x++)
                        {
                            Color c = from.GetPixel(x, y);
                            bmp.SetPixel(x, y, Color.FromArgb(c.A, (int)(c.R * factor), (int)(c.G * factor), (int)(c.B * factor)));
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

        // The glyph at src in one color, keeping its shape and alpha: the header and row icons
        // in the palettes of the themes that bring their own accent colors
        public bool Tint(string src, string path, string color)
        {
            try
            {
                Color c = Parse(color);
                using (var from = new Bitmap(src))
                using (var bmp = new Bitmap(from.Width, from.Height))
                {
                    for (int y = 0; y < from.Height; y++)
                        for (int x = 0; x < from.Width; x++)
                            bmp.SetPixel(x, y, Color.FromArgb(from.GetPixel(x, y).A, c));
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
