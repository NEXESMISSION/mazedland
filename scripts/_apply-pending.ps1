# Apply ALL pending migrations (any supabase/migrations/*.sql not yet recorded
# in supabase_migrations.schema_migrations) via the Supabase Management API,
# running each as postgres using the CLI access token from the Windows vault.
# No DB password, no pooler IPv6. Idempotent: skips already-applied versions and
# records each newly-applied version so `supabase migration list` stays in sync.
$ErrorActionPreference = 'Stop'
$ref = 'sajxoovrsoacfnytiijv'
$uri = "https://api.supabase.com/v1/projects/$ref/database/query"

$sig = @"
using System; using System.Runtime.InteropServices;
public class CredApi {
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);
  [StructLayout(LayoutKind.Sequential)]
  public struct CREDENTIAL { public int Flags; public int Type; public IntPtr TargetName; public IntPtr Comment; public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName; }
}
"@
$token = $env:SB_TOKEN
if (-not $token) {
  Add-Type -TypeDefinition $sig
  $ptr=[IntPtr]::Zero
  if(-not [CredApi]::CredRead("Supabase CLI:access-token",1,0,[ref]$ptr)){ Write-Output "CREDREAD_FAILED"; exit 1 }
  $c=[Runtime.InteropServices.Marshal]::PtrToStructure($ptr,[type][CredApi+CREDENTIAL])
  $b=New-Object byte[] $c.CredentialBlobSize
  [Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob,$b,0,$c.CredentialBlobSize)
  $token=[Text.Encoding]::UTF8.GetString($b)
  [CredApi]::CredFree($ptr)
}
$headers=@{ Authorization = "Bearer $token" }

function Invoke-Sql($q){
  $body = @{ query = $q } | ConvertTo-Json -Compress
  try { return Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $body -ContentType 'application/json' }
  catch { $m=$_.ErrorDetails.Message; if(-not $m){$m=$_.Exception.Message}; throw "API_ERROR: $m" }
}

try { $pre = Invoke-Sql "select current_database() as db, current_user as usr" }
catch { Write-Output "PREFLIGHT_FAILED: $_"; exit 3 }
Write-Output ("preflight ok: " + ($pre | ConvertTo-Json -Compress))

$appliedRows = Invoke-Sql "select version from supabase_migrations.schema_migrations"
$applied = @($appliedRows | ForEach-Object { $_.version })

$ok = 0
$files = Get-ChildItem "supabase/migrations" -Filter "*.sql" | Sort-Object Name
foreach($file in $files){
  if($file.BaseName -notmatch '^(\d+)_'){ continue }
  $v = $Matches[1]
  if($applied -contains $v){ Write-Output "= $v : already applied"; continue }
  $name = $file.BaseName -replace '^\d+_',''
  $sql = Get-Content $file.FullName -Raw
  try { Invoke-Sql $sql | Out-Null } catch { Write-Output "X $v DDL FAILED: $_"; exit 4 }
  $esc = $name -replace "'","''"
  $hist = "insert into supabase_migrations.schema_migrations (version,name,statements) values ('$v','$esc','{}') on conflict (version) do nothing;"
  try { Invoke-Sql $hist | Out-Null } catch { Write-Output "  (history note skipped for $v)" }
  Write-Output "OK $v $name"
  $ok++
}
Write-Output "APPLIED $ok migration(s)."
