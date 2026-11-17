-- roda sozinho no start, é tudo "if not exists"
create table if not exists clientes (
  id serial primary key,
  nome text not null,
  email text not null unique,
  senha_hash text not null,
  cpf text,
  telefone text,
  cep text, rua text, numero text, complemento text, bairro text, cidade text, uf text,
  is_admin boolean not null default false,
  criado_em timestamptz not null default now()
);

create table if not exists senha_tokens (
  token text primary key,
  cliente_id int not null references clientes(id) on delete cascade,
  expira_em timestamptz not null
);

create table if not exists categorias (
  id serial primary key,
  nome text not null,
  slug text not null unique,
  ordem int not null default 0
);

create table if not exists imagens (
  id serial primary key,
  mime text not null,
  dados bytea not null,
  criado_em timestamptz not null default now()
);

create table if not exists produtos (
  id serial primary key,
  categoria_id int references categorias(id) on delete set null,
  nome text not null,
  slug text not null unique,
  descricao text default '',
  preco numeric(10,2) not null,
  preco_antigo numeric(10,2),
  imagens int[] not null default '{}',
  destaque boolean not null default false,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists variantes (
  id serial primary key,
  produto_id int not null references produtos(id) on delete cascade,
  tamanho text not null,
  estoque int not null default 0,
  ordem int not null default 0,
  unique (produto_id, tamanho)
);

create table if not exists favoritos (
  cliente_id int references clientes(id) on delete cascade,
  produto_id int references produtos(id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (cliente_id, produto_id)
);

create table if not exists cupons (
  codigo text primary key,
  percentual numeric(5,2) not null,
  so_primeira_compra boolean not null default false,
  ativo boolean not null default true,
  valido_ate date
);

create table if not exists banners (
  id serial primary key,
  titulo text,
  subtitulo text,
  imagem_id int references imagens(id) on delete set null,
  link text default '/produtos',
  ordem int not null default 0,
  ativo boolean not null default true
);

create table if not exists pedidos (
  id serial primary key,
  cliente_id int not null references clientes(id),
  status text not null default 'aguardando', -- aguardando | pago | enviado | cancelado
  subtotal numeric(10,2) not null,
  desconto numeric(10,2) not null default 0,
  frete numeric(10,2) not null default 0,
  total numeric(10,2) not null,
  cupom text,
  endereco jsonb not null,
  mp_preference_id text,
  mp_payment_id text,
  rastreio text,
  criado_em timestamptz not null default now(),
  pago_em timestamptz,
  enviado_em timestamptz
);

create table if not exists pedido_itens (
  id serial primary key,
  pedido_id int not null references pedidos(id) on delete cascade,
  produto_id int references produtos(id) on delete set null,
  variante_id int references variantes(id) on delete set null,
  nome text not null,
  tamanho text not null,
  preco numeric(10,2) not null,
  qtd int not null
);

create index if not exists idx_pedidos_cliente on pedidos(cliente_id);
create index if not exists idx_produtos_cat on produtos(categoria_id);
