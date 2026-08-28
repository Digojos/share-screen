<#
  Prepara e limpa o ambiente de teste.

  Duas armadilhas ja custaram caro nesta base:

  1. Liberar a porta mata o servidor, mas o `tsx watch` que o supervisiona
     sobrevive sem porta e reinicia o processo na proxima alteracao de arquivo.
     Uma sessao longa acumula dezenas deles.

  2. Tentar achar esses orfaos por heuristica (idade, linha de comando) NAO
     funciona: o `npm run dev` do usuario usa exatamente os mesmos comandos.
     Uma regra por tempo ja matou o terminal de quem estava usando a maquina.

  Por isso a atribuicao e explicita: -Marcar antes de subir a pilha de teste,
  -Limpar depois. So morre o que nasceu no meio.

  Uso:
    powershell -NoProfile -File ambiente.ps1 -Marcar
    powershell -NoProfile -File ambiente.ps1 -Limpar 3002 5175
#>
param(
  [switch]$Marcar,
  [switch]$Limpar,
  [Parameter(ValueFromRemainingArguments = $true)][int[]]$Portas
)

$marca = Join-Path $env:TEMP 'share-screen-processos.txt'

if ($Marcar) {
  (Get-Process node -ErrorAction SilentlyContinue).Id | Set-Content -Path $marca -Encoding ascii
  $qtd = @(Get-Process node -ErrorAction SilentlyContinue).Count
  Write-Output "marcados $qtd processos node existentes"
  return
}

if (-not $Limpar) { Write-Output "use -Marcar antes dos testes, ou -Limpar depois"; return }

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

if (Test-Path $marca) {
  $antigos = @(Get-Content $marca | ForEach-Object { [int]$_ })
  $novos = @(Get-Process node -ErrorAction SilentlyContinue | Where-Object { $antigos -notcontains $_.Id })
  foreach ($p in $novos) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
  Write-Output "encerrados $($novos.Count) processos node criados durante os testes"
  Remove-Item $marca -ErrorAction SilentlyContinue
} else {
  Write-Output "sem marcacao previa: nenhum processo encerrado por atribuicao"
  Write-Output "(rode -Marcar antes dos testes para permitir a limpeza)"
}

foreach ($porta in @(3001, 5173)) {
  if (Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue) {
    Write-Output "porta $porta ocupada (ambiente do usuario - NAO tocar)"
  } else {
    Write-Output "porta $porta livre"
  }
}
