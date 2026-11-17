# Contexto do projeto — leia antes de mexer

Loja virtual de moda feminina da Vitória. Começou numa conversa no Claude (chat) e continua aqui.
Responder sempre em português.

## O que ela pediu
- Loja com as mesmas funções da Dress It Up Store (dressitupstore.com.br): faixa de cupom, menu com
  Como comprar / Trocas / Envio / FAQ / Contato / Quem somos, busca, sacola, carrossel de banners,
  faixa de benefícios (envio, 8x sem juros, segurança), botões de categoria, cards de coleção, Destaques,
  WhatsApp flutuante, aviso de cookies, cadastro/login.
- Visual: MISTURA da Dress It Up com a Alexandra Dobre (alexandra-dobre.com): fundo cinza quente,
  fotos grandes 7:10, nome centralizado, botão preto arredondado "Quick Add", coração de favoritos.
  Não copiar logo, fotos nem textos de nenhuma das duas. Nome "Meridiana" é provisório.
- Funciona de verdade: banco de dados, cliente se cadastra, coloca o CEP e o endereço aparece sozinho,
  paga e recebe e-mail automático.
- Pagamento: Mercado Pago (decidido). Hospedagem: ainda não decidiu (guia sugere Render + Neon).

## Como está feito
- Node 20+, Express 5, Postgres (pg), EJS, sessão em Postgres (connect-pg-simple), bcryptjs, nodemailer, multer
- `src/server.js` entrada · `src/schema.sql` tabelas (criadas no start) · `src/seed.js` dados iniciais + admin
- `src/rotas/` loja, conta, checkout (MP + webhook + modo teste), admin
- `src/sacola.js` cálculo de sacola/cupom/frete (frete = tabela por UF, provisório)
- `src/pagamento.js` Mercado Pago Checkout Pro; sempre confere o pagamento na API antes de marcar pago
- `src/mail.js` e-mails: boas-vindas, pagamento aprovado, enviado com rastreio, redefinir senha, contato
- `views/` EJS · `public/css/loja.css` · `public/js/loja.js` (carrossel, quick add, ViaCEP, máscaras)
- Imagens ficam no banco (tabela `imagens`), servidas em `/img/:id`
- Sem MP_ACCESS_TOKEN = modo teste (botão simula pagamento). Sem SMTP = e-mail só no console.
- Detalhes de deploy: COMO-COLOCAR-NO-AR.md

## Já testado
Cadastro, CEP, cupom BEMVINDA (só 1ª compra), checkout, pagamento simulado, baixa de estoque,
e-mails, painel admin (rastreio, produto com foto, cupom), esqueci a senha, 404, layout desktop e celular.
Chamada real ao Mercado Pago ainda NÃO foi testada (precisa das credenciais dela).

## Pendências
- Credenciais Mercado Pago, SMTP, deploy, domínio
- Textos com [colchetes] nas páginas institucionais
- Fotos reais (pelo painel /admin)
- Frete real (Melhor Envio) e nota fiscal (Bling/Tiny) — próxima etapa

## Estilo de código que ela quer
Código com cara de feito por pessoa, não por IA: sem comentário óbvio em toda linha, nomes concretos
(nada de handleData/data1), comentários curtos e informais, sem emojis nem blocos decorativos,
sem abstração acadêmica, sem README de template. Pequenas imperfeições inofensivas tudo bem.
No CSS, nada de gradiente roxo, cards com sombra idêntica ou layout genérico centralizado.
