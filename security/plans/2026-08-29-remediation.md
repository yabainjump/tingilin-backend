# Plan de remediation securite — 2026-08-29

## Termine dans cette livraison

- [x] Supprimer les secrets JWT d'exemple et bloquer les configurations de
  production dangereuses.
- [x] Fermer l'exposition reseau MongoDB du compose par defaut.
- [x] Rendre atomique le controle d'eligibilite lors de l'attribution des
  tickets.
- [x] Borner et reduire le cout des connexions Socket.IO.
- [x] Durcir les codes de reinitialisation et le verrouillage de connexion.
- [x] Securiser le cycle de vie des avatars.
- [x] Filtrer les tombolas et produits non publies.
- [x] Refuser les liens de paiement non HTTPS.
- [x] Corriger les dependances de production vulnerables.

## Avant le prochain deploiement

- [ ] Generer deux secrets JWT independants et aleatoires (au moins 32 octets)
  dans le gestionnaire de secrets de l'hebergeur.
- [ ] Confirmer que les deux drapeaux de developpement sont a `false`.
- [ ] Activer l'authentification MongoDB et verifier les ACL reseau.
- [ ] Regler `LIVE_DRAW_MAX_CONNECTIONS` selon la capacite mesuree du serveur.
- [ ] Tester le webhook Digikuntz signe et le rapprochement d'un paiement tardif
  sur la preproduction.
- [ ] Tester sauvegarde et restauration MongoDB.

## Suivi

- [ ] Reexecuter `npm audit` chaque semaine et apres chaque changement de lockfile.
- [ ] Mettre a jour la chaine Angular lorsque les dependances transitives
  `image-size` et `uuid` seront corrigees sans downgrade cassant.
- [ ] Realiser un test d'intrusion externe avant une release financiere majeure.
- [ ] Rejouer `security/vibe-check/AI-CHECKLIST.md` avant chaque mise en production.

