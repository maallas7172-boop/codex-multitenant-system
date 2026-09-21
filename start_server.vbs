Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "node local_relay_sync.js", 0, False
WScript.Sleep 500
WshShell.Run "node server.js", 0, False
WScript.Sleep 1000
WshShell.Run "http://localhost:8080/login.html"
