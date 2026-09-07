using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        string exeDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        string[] roots =
        {
            exeDir,
            Path.GetFullPath(Path.Combine(exeDir, "..")),
            @"D:\VoxAI-Studio-v2.5"
        };

        string electronExe = null;
        string workDir = null;
        foreach (string root in roots)
        {
            if (string.IsNullOrWhiteSpace(root)) continue;
            string candidate = Path.Combine(root, "electron", "node_modules", "electron", "dist", "electron.exe");
            if (File.Exists(candidate))
            {
                electronExe = candidate;
                workDir = Path.Combine(root, "electron");
                break;
            }
        }

        if (electronExe == null)
        {
            MessageBox.Show(
                "找不到 Electron。\n\n请先在工程目录运行 scripts\\setup.cmd",
                "VoxAI Studio",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        var psi = new ProcessStartInfo
        {
            FileName = electronExe,
            Arguments = ".",
            WorkingDirectory = workDir,
            UseShellExecute = false
        };

        try
        {
            Process.Start(psi);
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "VoxAI Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
