<#
  Libera portas ocupadas por processos de teste.

  Parar a task de background nao mata o filho do npm: sobra um processo node
  segurando a porta, e o proximo `npm run dev` morre com EADDRINUSE.

  Uso: powershell -NoProfile -File liberar-portas.ps1 3002 5175
#>
param([Parameter(ValueFromRemainingArguments = $true)][int[]]$Portas)

if (-not $Portas) { $Portas = @(3002, 5175) }

foreach ($porta in $Portas) {
  $conexoes = Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue
  if ($conexoes) {
    $conexoes | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    Write-Output "porta $porta liberada"
  } else {
    Write-Output "porta $porta ja livre"
  }
}

# As portas do ambiente da pessoa nao devem ser tocadas, apenas conferidas.
foreach ($porta in @(3001, 5173)) {
  if (Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue) {
    Write-Output "porta $porta ocupada (provavelmente o npm run dev do usuario - NAO matar)"
  } else {
    Write-Output "porta $porta livre"
  }
}
