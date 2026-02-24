# Belka.io

<p align="center">
  <img src="https://img.shields.io/badge/Vite-5.0-blue" />
  <img src="https://img.shields.io/badge/Firebase-Auth-yellow" />
  <img src="https://img.shields.io/badge/Supabase-Realtime-24b47e" />
  <img src="https://img.shields.io/badge/Docker-Enabled-blue" />
</p>

Belka.io est un projet d'évaluation consistant à reproduire les mécaniques fondamentales du célèbre jeu **Agar.io** tout en profitant d'une stack technique moderne avec intégration de base de données en temps réel serverless.

## Fonctionnalités 🎮

- **Authentification Single Sign-On (SSO)** : Connexion sécurisée en 1-clic via Google grâce à Firebase Auth.
- **Multijoueur en temps réel** : Synchronisation des positions, masses et des interactions grâce à **Supabase Realtime** configuré avec un tick-rate optimisé et une interpolation client fluide pour garantir l'absence de lag visuel.
- **Mécanique "Eat to grow"** : Mangez la nourriture environnante (`pixels`) pour augmenter votre masse corporelle.
- **Caméra Dynamique** : La vue de la caméra se "dézoome" au fur et à mesure que votre cellule grandit pour une expérience de jeu Agar.io fidèle.
- **Les Virus** : De grandes boules vertes piquantes ont fait leur apparition ! Attention : si vous êtes plus grand qu'un virus et que vous le percutez, votre cellule explosera subitement (perte de masse).

## Stack Technique 🛠️

- **Frontend** : HTML5 Canvas, Vanilla JavaScript ES6
- **Build tool** : Vite.js
- **Authentification** : Firebase (SSO Google)
- **Base de données Temps Réel** : Supabase (PostgreSQL + Realtime Channels)
- **Conteneurisation** : Multi-stage build Docker (Vite build + Serveur web Nginx)

## Déploiement et Reverse Proxy 🌐

### Installer le Projet Localement
Si vous récupérez le code source, vous pouvez démarrer le serveur Web conteneurisé très simplement à l'aide de Docker :
```bash
docker-compose up -d --build
```
*Le jeu sera accessible localement sur `http://localhost:6278`.*

### Informations sur Traefik et les Reverse Proxies
**Pour l'évaluateur** : Si vous hébergez le conteneur `belka-io-web` sur un ordinateur de bureau fixe (*ex: 192.168.1.151*) et que vous utilisez **Traefik** installé sur un serveur NAS du même réseau (*ex: 192.168.1.100*) pour rediriger `belkaio.ghillas.fr` vers votre PC, **assurez-vous d'avoir ouvert le pare-feu**.

Par défaut, Windows Defender Firewall bloquera la requête HTTP entrante de Traefik vers le port `6278` de votre ordinateur fixe. Vous devez rajouter une règle autorisant le port entrant 6278 depuis Windows :

**Ouvrez PowerShell en mode Administrateur et exécutez la commande suivante :**
```powershell
New-NetFirewallRule -DisplayName "belka.io-6278-Traefik" -Direction Inbound -LocalPort 6278 -Protocol TCP -Action Allow
```
Dès que cette règle sera active, la page `belkaio.ghillas.fr` affichera immédiatement le jeu à travers le proxy Synology.

## Auteurs
* **Belkacem** - Évaluation Full-stack/Devops
