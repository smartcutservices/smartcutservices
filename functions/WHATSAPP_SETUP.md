# WhatsApp Business Cloud API - mise en service

1. Créez les cinq secrets Firebase : `WHATSAPP_ACCESS_TOKEN`,
   `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`,
   `WHATSAPP_VERIFY_TOKEN` et `WHATSAPP_GRAPH_API_VERSION`.
2. Déployez les fonctions WhatsApp et les règles Firestore.
3. Dans Meta Business Manager, définissez le callback sur
   `https://us-central1-smartcutservices-9ce54.cloudfunctions.net/whatsappWebhook`
   puis abonnez le webhook au champ `messages`.
4. Créez et faites approuver trois templates : un `utility` pour les
   confirmations de commande, un `marketing` pour les nouveautés et un
   template de support pour les réponses hors de la fenêtre de 24 heures.
5. Dans le module Dashboard WhatsApp, renseignez leurs noms exacts. Laissez le
   marketing désactivé, faites un test avec un numéro interne, puis activez-le.

Les noms des templates sont configurés par l'administrateur et ne sont jamais
codés en dur. Les numéros clients, consentements, conversations et journaux
d'envoi restent accessibles uniquement via les Cloud Functions.
