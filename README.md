# 🍌 belka.io - Agario Clone

Bienvenue sur le dépôt de **belka.io**, un clone complet, multijoueur, et optimisé du célèbre jeu Agar.io, développé dans le cadre d'un projet académique.

![Gameplay Screenshot](file:///C:/Users/Belkacem/.gemini/antigravity/brain/5d446f7f-40bd-4895-8e48-c11568836c52/gameplay_or_lobby_screenshot_1771942388258.png)

## 🌐 Liens Utiles
- **Jeu en direct :** [http://belkaio.ghillas.fr](http://belkaio.ghillas.fr)
- **Déploiement Automatisé :** Script `deploy.sh` inclus pour la mise en ligne.

## 🚀 Fonctionnalités Clés
1. **Multijoueur en temps réel (Peer-to-Peer) :**
   - Synchronisation ultra-rapide et sans latence (20 FPS) grâce au système **PubSub Broadcast** de Supabase (WebSockets type UDP).
   - Plus de freezes ni de rollbacks grâce à l'élimination des goulots d'étranglement de la base de données PostgreSQL.
2. **Physique & Gameplay Fluide :**
   - Mécaniques fidèles à Agar.io : Mangez la nourriture pour grandir.
   - Touche `Espace` pour vous diviser et propulser vos cellules vers l'avant.
   - Les cellules séparées finissent par se regrouper automatiquement avec une physique d'attraction douce.
   - Les virus (verts) font exploser les cellules trop grosses en plusieurs morceaux.
3. **Menu et Lobby Pré-partie :**
   - Interface "Glassmorphism" moderne et épurée.
   - Vue en direct des joueurs connectés dans l'arène avant même de rejoindre la partie.
   - Classement dynamique top 10.
4. **Personnalisation Poussée :**
   - Choisissez un *pseudo invité* avec une couleur personnalisée via la nouvelle **Palette de couleurs**.
   - Option **Texte Arc-en-ciel** dynamique.
   - Intégration d'un système de **Skins (Images) URL ou upload local** (convertis en Base64).
5. **Authentification SSO Google :**
   - Possibilité de s'identifier via Google (Firebase Auth) pour sauvegarder ses scores.

## 🛠️ Architecture Technique (Stack)
Ce projet respecte l'ensemble des consignes de livraison :
- **Frontend :** HTML5 Canvas, Vanilla CSS (Glassmorphism), JavaScript (Vite).
- **Backend & Realtime :** **Supabase** (PostgreSQL + Realtime Channels).
- **Authentification :** **Firebase Authentication** (Google SSO).
- **Conteneurisation :** **Docker** & **Docker Compose** (Serveur Web Nginx).

![Login Menu](file:///C:/Users/Belkacem/.gemini/antigravity/brain/5d446f7f-40bd-4895-8e48-c11568836c52/gameplay_screenshot_1771942379309.png)

## ⚙️ Optimisations Moteur
Afin d'assurer sa viabilité sur navigateur :
- **Culling Spatial (Viewport) :** Le moteur Canvas ignore le rendu de tous les pixels (nourriture) et ennemis situés en dehors de l'écran du joueur courant, économisant le processeur graphique.
- **Collisions AABB (Bounding Box) :** Remplacement des calculs intensifs de racines carrées (Math.sqrt) continus par un pré-filtre carré exclusif, sautant instantanément l'analyse des positions trop éloignées (Gain massif de FPS CPU).

## 🐳 Instruction de Lancement (Local avec Docker)
Clonez ce repository et lancez le jeu localement en une seule commande via Docker Compose :
```bash
docker compose up -d --build
```
L'application sera disponible sur `http://localhost:8080`.

---
*Projet développé et corrigé pour répondre aux critères stricts du TP (Compte Rendu, Docker, Git, Cloud Provider).*
