$configFile = Join-Path $PSScriptRoot "config.json"
$configJsFile = Join-Path $PSScriptRoot "config.js"

$defaultJson = @'
{
  "storageKey": "flowforge-state-v2",
  "clock": {
    "min": 0.01,
    "max": 100,
    "step": 1,
    "defaultMin": 25
  },
  "routing": {
    "splitterSizes": [2, 3],
    "mergerSizes": [2, 3],
    "validationRadius": 20,
    "crossingDashRadiusMultiplier": 3
  },
  "geometry": {
    "routingNodeRadius": 10,
    "machinePortStem": 28,
    "machineBaseWidth": 170,
    "machineHeight": 84,
    "machineInstanceSpacing": 220,
    "topMargin": 170,
    "levelGap": 220,
    "boardMinWidth": 1200,
    "boardMinHeight": 560,
    "boardPadding": 48,
    "machineNodeGapMultiplier": 2,
    "outputTipOffset": 38,
    "splitterVerticalOffset": 46,
    "mergerVerticalOffset": 46,
    "parallelNodeYOffsetStep": 16,
    "machineLabelLine1Offset": -12,
    "machineLabelLine2Offset": 8,
    "machineLabelLine3Offset": 28
  },
  "belt": {
    "minWidth": 8,
    "laneSpacingMultiplier": 2,
    "arrowSpacing": 42,
    "arrowMinOffset": 8,
    "arrowSize": 7,
    "baseStroke": 4,
    "extraStroke": 4,
    "minimumRatio": 0.35,
    "parallelOverlapStep": 18,
    "protectedZoneDiameterMultiplier": 1,
    "machineSpacingDiameterMultiplier": 1
  },
  "power": {
    "clockExponent": 1.321928
  },
  "defaults": {
    "maxPower": 1000,
    "enableOverflow": true,
    "targetOutputRate": 60,
    "beltSpeeds": [
      { "speed": 60, "color": "blue" },
      { "speed": 120, "color": "red" },
      { "speed": 270, "color": "yellow" },
      { "speed": 480, "color": "limegreen" },
      { "speed": 780, "color": "orange" }
    ]
  }
}
'@

function Convert-ToHashtable {
  param([object]$Value)

  if ($null -eq $Value) { return $null }

  if ($Value -is [System.Collections.IDictionary]) {
    $result = @{}
    foreach ($key in $Value.Keys) {
      $result[$key] = Convert-ToHashtable $Value[$key]
    }
    return $result
  }

  if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
    $items = New-Object System.Collections.ArrayList
    foreach ($item in $Value) {
      [void]$items.Add((Convert-ToHashtable $item))
    }
    return ,$items.ToArray()
  }

  if ($Value -is [psobject] -and $Value.PSObject.Properties.Count -gt 0) {
    $result = @{}
    foreach ($property in $Value.PSObject.Properties) {
      $result[$property.Name] = Convert-ToHashtable $property.Value
    }
    return $result
  }

  return $Value
}

function Merge-MissingKeys {
  param(
    [hashtable]$Existing,
    [hashtable]$Defaults
  )

  foreach ($key in $Defaults.Keys) {
    if (-not $Existing.ContainsKey($key)) {
      $Existing[$key] = $Defaults[$key]
      continue
    }

    if ($Existing[$key] -is [hashtable] -and $Defaults[$key] -is [hashtable]) {
      Merge-MissingKeys -Existing $Existing[$key] -Defaults $Defaults[$key]
    }
  }
}

$defaults = Convert-ToHashtable (ConvertFrom-Json $defaultJson)
$finalConfig = $defaults

if (Test-Path $configFile) {
  try {
    $existing = Convert-ToHashtable (Get-Content -Raw $configFile | ConvertFrom-Json)
    if ($existing -is [hashtable]) {
      Merge-MissingKeys -Existing $existing -Defaults $defaults
      $finalConfig = $existing
    }
  } catch {
    $finalConfig = $defaults
  }
}

$json = $finalConfig | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($configFile, $json + [Environment]::NewLine, [System.Text.Encoding]::UTF8)
[System.IO.File]::WriteAllText($configJsFile, "window.FLOWFORGE_CONFIG = Object.freeze($json);" + [Environment]::NewLine, [System.Text.Encoding]::UTF8)
Write-Host "Generated $configFile"
Write-Host "Generated $configJsFile"
