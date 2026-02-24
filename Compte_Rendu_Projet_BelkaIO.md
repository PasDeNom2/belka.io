# Compte Rendu de Projet : belka.io (Clone d'Agar.io)

## 1. Introduction
Ce compte rendu détaille la conception, l'architecture et le déploiement de **belka.io**, un jeu multijoueur web en temps réel inspiré par Agar.io. 
L'objectif de ce projet était de construire une application amusante, complexe techniquement, et de répondre rigoureusement aux exigences d'infrastructure cloud, de conteneurisation Docker, et de gestion de version via GitHub.

## 2. Le Projet : belka.io
**belka.io** est un jeu de survie en arène où chaque joueur contrôle une cellule (ou plusieurs après division). Les mécaniques fondamentales implémentées incluent :
- Une physique de déplacement fluide via un rendu Canvas HTML5 (60 FPS).
- La division cellulaire avec la touche `Espace` (split) pour chasser ou fuir.
- Une physique complexe de fusion et d'expulsion de masse, ainsi que l'intégration des "virus" (mines vertes) qui font exploser les joueurs trop imposants.
- Des fonctionnalités avancées comme le téléchargement de skins personnalisés, un lobby pour voir les joueurs connectés, et un choix de couleurs dynamiques (Texte Arc-en-ciel).

**Aperçu du jeu en action (Menu & Gameplay) :**
![Login Menu](C:\Users\Belkacem\.gemini\antigravity\brain\5d446f7f-40bd-4895-8e48-c11568836c52\gameplay_screenshot_1771942379309.png)
![Gameplay Screenshot](C:\Users\Belkacem\.gemini\antigravity\brain\5d446f7f-40bd-4895-8e48-c11568836c52\gameplay_or_lobby_screenshot_1771942388258.png)

## 3. Conteneurisation (Docker)
L'application a été entièrement "dockerisée", ce qui garantit qu'elle peut s'exécuter de manière identique sur n'importe quelle machine sans conflit de dépendances.
- **Dockerfile :** Construit autour de `nginx:alpine`, assurant un serveur web extrêmement léger et performant. Il copie les fichiers sources statiques (`index.html`, `src/`) dans le répertoire public `usr/share/nginx/html`.
- **Docker Compose :** Le fichier `docker-compose.yml` orchestre le conteneur, exposant le port interne `80` sur le port local `8080`, simplifiant le lancement à une unique commande (`docker compose up -d`).

## 4. Services Cloud Utilisés
Afin de gérer la nature massivement multijoueur, l'authentification et l'hébergement de la base de données, l'application repose sur **deux** piliers Cloud :

### A. Supabase (BaaS Principal : PostgreSQL & Realtime)
Supabase a été privilégié pour ses capacités temps réel (Realtime Channels) couplées à la robustesse de PostgreSQL.
- **Base de données :** Une table `players` (pour la sauvegarde globale) et `pixels` (pour la génération de la nourriture répartie). Des scripts SQL (ex: `init.sql`) sont intégrés au dépôt Github.
- **Optimisation UDP-like (PubSub Broadcast) :** Supabase a été exploité pour créer un réseau "Peer-to-Peer" à très faible latence (20 requêtes par seconde) grâce aux *Broadcast Channels*. Les mouvements des joueurs sont streamés d'un client à l'autre via WebSockets **sans écriture en base de données**, évitant de surcharger le serveur avec des requêtes SQL lourdes et annulant les rollbacks.

### B. Firebase (Authentification Google SSO)
Pour la persistance des joueurs et la sauvegarde des configurations avancées entre les parties (Pseudo, Skin), le module _Firebase Authentication_ a été intégré. Il permet aux joueurs de se connecter d'un simple clic (« Se connecter pour Sauvegarder ») tout en sécurisant leurs identifiants externes.

## 5. Gestion de version et Dépôt
L'intégralité du code source a été versionnée avec *Git* et poussée sur le dépôt public demandé.
**Lien du GitHub :** [https://github.com/byfect/belkaio](https://github.com/byfect/belkaio) *(Lien adaptatif selon le nom exact du repo hébergé)*

Sont inclus : l'infrastructure Docker (`Dockerfile`, `docker-compose.yml`), les sources (`src/`), la configuration de base de données (`init.sql`) et le script de versionnement automatisé (`deploy.sh`).

## 6. Conclusion
Le développement de **belka.io** m'a permis de solidifier ma compréhension des environnements Cloud (Supabase/Firebase) appliqués à des contraintes de haute performance (jeux en temps réel multijoueurs). L'architecture Docker adoptée rend l'application immédiatement déployable. Le respect des consignes du projet montre que la combinaison de ces micro-services offre une base redoutable pour des projets Web complexes.
