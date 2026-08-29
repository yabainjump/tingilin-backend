# Audit de securite Tinguilin — 2026-08-29

## Portee et methode

Audit statique du backend NestJS/MongoDB, de l'application Ionic/Angular et de
l'administration Angular. La methode reprend Vibe Check (17 familles de
controles), puis verifie les chemins propres a Tinguilin : authentification,
roles administrateur, paiements Digikuntz, attribution de tickets, tirage,
uploads et WebSocket.

Cet audit comprend la lecture du code, l'analyse des dependances, des tests de
non-regression et une revue distincte des correctifs. Il ne comprend pas de
test d'intrusion sur l'infrastructure de production ni de test actif du compte
Digikuntz.

## Modele de menace synthetique

- Actifs critiques : comptes, roles, secrets JWT, donnees personnelles,
  transactions, tickets et integrite des tirages.
- Frontieres : navigateur client/admin vers API, API vers MongoDB, API vers
  Digikuntz, webhook Digikuntz vers API, stockage des uploads et clients
  Socket.IO.
- Adversaires consideres : visiteur non authentifie, utilisateur authentifie
  malveillant, attaquant ayant lu la base, fournisseur externe compromis et
  erreur de configuration au deploiement.

## Correctifs appliques

### Priorite haute

1. **Secrets JWT d'exemple reutilisables (CWE-798).** Les valeurs fixes ont ete
   retirees de `.env.example`. La validation de demarrage refuse maintenant les
   placeholders et les secrets faibles (`src/common/config/runtime-security.ts`).
2. **MongoDB publie sur toutes les interfaces (CWE-284).** Le compose de
   developpement lie desormais le port a `127.0.0.1` seulement
   (`docker-compose.yml`).

### Priorite moyenne

3. **Tickets attribuables apres fermeture d'une tombola (CWE-367).** La
   finalisation d'un paiement exige maintenant, dans la meme operation MongoDB,
   une tombola `LIVE`, dans sa fenetre temporelle et avec une capacite
   suffisante (`src/modules/raffles/raffles.service.ts`).
4. **Amplification et croissance non bornee des connexions temps reel
   (CWE-400).** Une capacite maximale configurable a ete ajoutee, et les
   diffusions globales a chaque connexion/deconnexion ont ete supprimees
   (`src/modules/raffles/raffles.live.gateway.ts`).
5. **Codes de reinitialisation crackables hors ligne (CWE-916).** Le SHA-256
   simple a ete remplace par un HMAC-SHA-256 lie au secret de rafraichissement
   (`src/modules/auth/auth.service.ts`).
6. **Verrouillage de connexion utilisable pour bloquer un compte (CWE-307).**
   La comparaison bcrypt est executee avant la decision de verrouillage ; un
   proprietaire disposant du bon mot de passe n'est plus bloque par les essais
   d'un tiers (`src/modules/auth/auth.service.ts`).
7. **Fichiers avatar orphelins (CWE-400).** L'avatar ne peut plus etre injecte
   comme URL dans les DTO. Le remplacement est atomique et nettoie les fichiers
   applicatifs precedents (`src/modules/users`, `src/common/uploads`).

### Durcissements complementaires

- Les liens de paiement Digikuntz sont limites a HTTPS dans l'API et dans le
  client Ionic.
- Les tombolas brouillon et les produits non publies ne sont plus exposes par
  les routes publiques ; `realValue` n'est plus renvoye publiquement.
- Le demarrage en production refuse `AUTH_BOOTSTRAP_FIRST_ADMIN=true` et
  `ENABLE_MOCK_PAYMENTS=true`.
- Les versions Angular ont ete mises a jour vers `20.3.30`, le toolchain vers
  `20.3.35`, et `sharp` vers `0.35.4`.

## Dependances

`npm audit --omit=dev` retourne **0 vulnerabilite de production** pour les trois
projets. Le backend retourne egalement 0 sur l'audit complet.

Les deux frontends conservent 7 alertes uniquement dans la chaine de build
(4 moderees, 3 hautes), transitives via `image-size`/Less et
`uuid`/SockJS/Webpack Dev Server. `npm audit fix --force` propose une regression
majeure incoherente du toolchain Angular ; elle n'a pas ete appliquee. Les
serveurs de developpement ne doivent jamais etre exposes publiquement.

## Risques residuels et controles obligatoires

1. Activer l'authentification MongoDB et limiter le reseau dans tout environnement
   partage ; le bind loopback du compose ne remplace pas l'authentification.
2. Configurer le reverse proxy avec TLS, limites de requetes et limites de
   connexions WebSocket par IP. `LIVE_DRAW_MAX_CONNECTIONS` limite le total,
   pas chaque origine.
3. Definir une procedure de rapprochement/remboursement lorsqu'un fournisseur
   confirme un paiement apres fermeture : aucun ticket n'est cree, mais la
   transaction doit etre traitee operationnellement.
4. Les anciens codes de reinitialisation emis avant ce deploiement deviennent
   invalides. Leur duree de vie etant de 15 minutes, deployer puis attendre cette
   fenetre avant investigation d'un echec utilisateur.
5. Verifier en production les valeurs CORS, les URLs publiques, les secrets, la
   signature du webhook Digikuntz, les sauvegardes/restaurations et les journaux
   sans donnees sensibles.
6. Executer un test d'intrusion authentifie sur une preproduction isolee avant
   une release financiere majeure.

## Validation executee

- Backend : lint, build et 22 suites Jest / 81 tests reussis.
- Ionic : lint, build et 41 tests reussis.
- Administration : lint, build et 1 test reussi.
- `npm ls --depth=0` reussi sur les trois projets.
- `git diff --check` reussi sur les trois projets.
