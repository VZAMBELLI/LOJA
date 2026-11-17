# Loja — como rodar e colocar no ar

Node + Express + Postgres. Sem framework de front, só EJS e um loja.js.

## O que já faz

- cadastro com CPF validado, telefone e endereço que se preenche sozinho pelo CEP (ViaCEP)
- login, "esqueci a senha" por e-mail, minha conta, pedidos, favoritos (coração)
- vitrine com Quick Add, página de produto com tamanhos e estoque, busca, ordenação
- sacola, cupom (BEMVINDA = 5% só na 1ª compra), frete por estado, frete grátis acima de X
- pagamento pelo Mercado Pago (cartão em até 8x, Pix, boleto)
- e-mails automáticos: boas-vindas, **pagamento aprovado** (com os itens) e **pedido enviado** (com rastreio)
- painel /admin: pedidos, marcar enviado + rastreio, cancelar (devolve estoque), produtos com fotos, estoque baixo, categorias, cupons, banners do carrossel, clientes
- páginas institucionais (os textos com [colchetes] você precisa revisar)

## Rodar no seu computador

```bash
npm install
cp .env.example .env      # e preencha DATABASE_URL, ADMIN_EMAIL, ADMIN_SENHA
npm run seed              # cria categorias, cupom, produtos de exemplo e o admin
npm run dev               # http://localhost:3000
```

Sem `MP_ACCESS_TOKEN` a loja entra em **modo teste**: o checkout mostra um botão "simular pagamento aprovado".
Sem `SMTP_HOST` os e-mails não saem, só aparecem no terminal.

Banco: o jeito mais fácil é criar um Postgres grátis no https://neon.tech, copiar a connection string pro DATABASE_URL e deixar `DATABASE_SSL=1`.

## Colocar no ar (Render)

1. Sobe esta pasta num repositório no seu GitHub (o .env NÃO vai, já tá no .gitignore)
2. render.com → New → **Web Service** → escolhe o repositório
   - Build: `npm install`
   - Start: `npm start`
3. Em Environment, coloca todas as variáveis do .env.example (com `NODE_ENV=production` e `BASE_URL=https://seudominio.com.br`)
4. No Shell do Render roda uma vez: `npm run seed`
5. Domínio próprio: Settings → Custom Domain, e aponta o DNS onde você comprou o domínio

Plano grátis do Render "dorme" depois de 15 min sem visita (primeira página demora ~30s). Pra loja de verdade vale o plano pago mais barato.
As fotos ficam salvas no banco, então não somem a cada deploy.

## Mercado Pago

1. https://www.mercadopago.com.br/developers → Suas integrações → Criar aplicação (Checkout Pro)
2. Credenciais de **teste** primeiro → `MP_ACCESS_TOKEN=TEST-...`
3. Webhooks → URL `https://seudominio.com.br/webhooks/mercadopago`, evento **Pagamentos**. Copia a assinatura secreta pro `MP_WEBHOOK_SECRET`
4. Testa com os cartões de teste do MP. Funcionou? Troca pelas credenciais de produção.

O site sempre confere o pagamento direto na API do MP (e confere se o valor bate com o pedido) antes de marcar como pago. Então ninguém consegue "fingir" um pagamento chamando a URL.

## E-mail

Qualquer SMTP serve. Gmail: ativa verificação em 2 etapas → "Senhas de app" → usa essa senha no SMTP_PASS
(`SMTP_HOST=smtp.gmail.com`, porta 587). Pra volume maior / não cair no spam, melhor um domínio próprio com Zoho, Brevo ou Resend.

## Falta / próximos passos

- frete real (Melhor Envio) — hoje é tabela por estado em `src/sacola.js`
- nota fiscal (Bling, Tiny) — integração separada
- estoque baixa só quando o pagamento aprova; se duas pessoas comprarem a última peça ao mesmo tempo, as duas conseguem pagar. Pra loja pequena tudo bem, mas fica de olho no "estoque baixo" do painel
