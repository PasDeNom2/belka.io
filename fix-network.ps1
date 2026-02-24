# Ce script doit être exécuté en tant qu'Administrateur !
Write-Host "Vérification des privilèges Administrateur..."
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Warning "Veuillez exécuter ce script dans un terminal PowerShell lancé en tant qu'Administrateur !"
    Break
}

# 1. Passer le réseau de Public à Privé
Write-Host "1. Changement du profil réseau en 'Privé'..."
$profile = Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Public' }
if ($profile) {
    Set-NetConnectionProfile -InterfaceAlias $profile.InterfaceAlias -NetworkCategory Private
    Write-Host "Réseau passé en Privé avec succès pour $($profile.InterfaceAlias)." -ForegroundColor Green
} else {
    Write-Host "Aucun réseau 'Public' détecté, ou déjà en 'Privé'." -ForegroundColor Yellow
}

# 2. Création d'un commutateur virtuel externe pour WSL
Write-Host "2. Création du commutateur Hyper-V (External Switch) pour WSL..."
$switchName = "WSL-Commutateur"
$adapterName = "Ethernet" # Le nom de ta carte physique connectée au routeur

$existingSwitch = Get-VMSwitch -Name $switchName -ErrorAction SilentlyContinue
if (-not $existingSwitch) {
    Write-Host "Création du commutateur externe (cela peut couper brièvement la connexion internet)..."
    New-VMSwitch -Name $switchName -NetAdapterName $adapterName -AllowManagementOS $true
    Write-Host "Commutateur $switchName créé !" -ForegroundColor Green
} else {
    Write-Host "Le commutateur $switchName existe déjà." -ForegroundColor Yellow
}

# 3. Modification de .wslconfig pour utiliser ce commutateur (Bridged Mode)
Write-Host "3. Mise en place de la configuration réseau dans .wslconfig..."
$wslConfigPath = "$env:USERPROFILE\.wslconfig"

$configContent = @"
[wsl2]
networkingMode=bridged
vmSwitch=$switchName
ipv6=true
"@

Set-Content -Path $wslConfigPath -Value $configContent
Write-Host "Fichier .wslconfig mis à jour." -ForegroundColor Green

# 4. Redémarrage de WSL
Write-Host "4. Redémarrage de WSL..."
wsl --shutdown

Write-Host "====== TERMINE ======" -ForegroundColor Green
Write-Host "ATTENTION :" -ForegroundColor Cyan
Write-Host "Maintenant que WSL est en mode Bridged (pont), ton conteneur Docker/WSL a obtenu SA PROPRE adresse IP sur ton routeur (ex: 192.168.1.X) !"
Write-Host "Pour connaitre cette nouvelle IP, tape: wsl hostname -I"
Write-Host "Dans ton fichier Traefik (drive-svc), tu devras remplacer 192.168.1.151 par cette nouvelle adresse IP pour que ça fonctionne ! "
