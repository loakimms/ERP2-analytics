param(
  # 외부(=NAS)가 접속할 포트. 기본 9223(기존 UI/서버 기대값 유지)
  [int] $ListenPort = 9223,
  # Chrome CDP가 실제로 떠 있는 로컬 포트(Chrome이 127.0.0.1만 바인딩하는 환경 대응)
  [int] $TargetPort = 9224,
  # 0.0.0.0: LAN 전체에서 접속 허용(방화벽/사설망에서만 허용 권장)
  [string] $ListenAddress = '0.0.0.0',
  [string] $TargetHost = '127.0.0.1'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info([string] $m) { Write-Host ("[INFO] " + $m) -ForegroundColor Cyan }
function Write-Warn([string] $m) { Write-Host ("[WARN] " + $m) -ForegroundColor Yellow }
function Write-Err([string] $m) { Write-Host ("[ERR] " + $m) -ForegroundColor Red }

Write-Info "Host CDP TCP proxy (user-mode)"
Write-Info (" - listen : {0}:{1}" -f $ListenAddress, $ListenPort)
Write-Info (" - target : {0}:{1}" -f $TargetHost, $TargetPort)
Write-Warn "주의: 사설망에서만 사용하세요. (Windows 방화벽에서 9223 인바운드 허용이 필요할 수 있음)"
Write-Info "종료: Ctrl+C"
Write-Host ""

# PowerShell의 Task/Thread 경계에서 함수(Pump) 호출이 깨져 "포워딩이 멈추는" 문제가 발생할 수 있어,
# 순수 .NET(C#)로 TCP 프록시를 구현한다. (NAS→PC CDP 포워딩 안정화)
Add-Type -TypeDefinition @"
using System;
using System.Net;
using System.Net.Sockets;
using System.Threading;

public static class HostCdpTcpProxy {
  private static void Pump(NetworkStream src, NetworkStream dst) {
    var buf = new byte[65536];
    try {
      while (true) {
        int n = src.Read(buf, 0, buf.Length);
        if (n <= 0) break;
        dst.Write(buf, 0, n);
        dst.Flush();
      }
    } catch { }
  }

  public static void Run(string listenAddress, int listenPort, string targetHost, int targetPort) {
    var ip = IPAddress.Parse(listenAddress);
    var listener = new TcpListener(ip, listenPort);
    listener.Start();
    while (true) {
      TcpClient client = null;
      TcpClient server = null;
      try {
        client = listener.AcceptTcpClient();
        server = new TcpClient();
        server.Connect(targetHost, targetPort);

        var c2s = client.GetStream();
        var s2c = server.GetStream();

        var t1 = new Thread(() => Pump(c2s, s2c));
        var t2 = new Thread(() => Pump(s2c, c2s));
        t1.IsBackground = true;
        t2.IsBackground = true;
        t1.Start();
        t2.Start();

        // detach: cleanup when either side closes
        var t3 = new Thread(() => {
          try {
            while (t1.IsAlive && t2.IsAlive) Thread.Sleep(200);
          } catch { }
          try { c2s.Close(); } catch { }
          try { s2c.Close(); } catch { }
          try { client.Close(); } catch { }
          try { server.Close(); } catch { }
        });
        t3.IsBackground = true;
        t3.Start();
      } catch {
        try { if (client != null) client.Close(); } catch { }
        try { if (server != null) server.Close(); } catch { }
      }
    }
  }
}
"@ -ErrorAction Stop | Out-Null

try {
  [HostCdpTcpProxy]::Run($ListenAddress, $ListenPort, $TargetHost, $TargetPort)
} catch {
  Write-Err ("Proxy failed: " + $_.Exception.Message)
  throw
}

