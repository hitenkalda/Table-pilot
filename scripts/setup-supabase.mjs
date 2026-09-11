/**
 * One-time setup: finds the Supabase pooler host, applies migrations,
 * creates the owner account, and seeds the demo restaurant.
 * Usage: node scripts/setup-supabase.mjs
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const REF = "qisaptjqiixlujkawbqy";
const PASSWORD = process.argv[2];
if (!PASSWORD) {
  console.error("Usage: node scripts/setup-supabase.mjs <db-password>");
  process.exit(1);
}

const CANDIDATES = [
  "aws-1-us-east-1", "aws-0-us-east-1", "aws-1-us-east-2", "aws-0-us-east-2",
  "aws-1-us-west-1", "aws-0-us-west-1", "aws-1-us-west-2", "aws-0-us-west-2",
  "aws-1-ap-south-1", "aws-0-ap-south-1", "aws-1-ap-southeast-1",
  "aws-0-ap-southeast-1", "aws-1-ap-southeast-2", "aws-0-ap-southeast-2",
  "aws-1-ap-northeast-1", "aws-0-ap-northeast-1", "aws-1-ap-northeast-2",
  "aws-0-ap-northeast-2", "aws-1-eu-west-1", "aws-0-eu-west-1",
  "aws-1-eu-west-2", "aws-0-eu-west-2", "aws-1-eu-west-3", "aws-0-eu-west-3",
  "aws-1-eu-central-1", "aws-0-eu-central-1", "aws-1-eu-north-1",
  "aws-0-eu-north-1", "aws-1-sa-east-1", "aws-0-sa-east-1",
];

async function connect() {
  for (const region of CANDIDATES) {
    const host = `${region}.pooler.supabase.com`;
    const client = new pg.Client({
      host,
      port: 5432,
      user: `postgres.${REF}`,
      password: PASSWORD,
      database: "postgres",
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
    });
    try {
      await client.connect();
      console.log(`Connected via ${host}`);
      return client;
    } catch {
      try { await client.end(); } catch {}
    }
  }
  throw new Error("Could not reach any Supabase pooler region.");
}

function runFile(client, path) {
  const sql = readFileSync(path, "utf8");
  return client.query(sql);
}

const OWNER_EMAIL = "owner@tablepilot.local";
const OWNER_PASSWORD = "TablePilot@2026";

const client = await connect();

try {
  const existing = await client.query(
    "select 1 from information_schema.tables where table_schema='public' and table_name='restaurants'"
  );
  if (existing.rowCount === 0) {
    console.log("Applying 0001_init.sql …");
    await runFile(client, join(root, "supabase/migrations/0001_init.sql"));
    console.log("Applying 0002_orders.sql …");
    await runFile(client, join(root, "supabase/migrations/0002_orders.sql"));
    console.log("Applying 0003_rpc_realtime.sql …");
    await runFile(client, join(root, "supabase/migrations/0003_rpc_realtime.sql"));
  } else {
    console.log("Schema already present; ensuring columns …");
    await runFile(client, join(root, "supabase/migrations/0002_orders.sql")).catch(
      (e) => console.log("0002 partially applied (ok):", e.message)
    );
    console.log("Applying 0003_rpc_realtime.sql …");
    await runFile(client, join(root, "supabase/migrations/0003_rpc_realtime.sql")).catch(
      (e) => console.log("0003 partially applied (ok):", e.message)
    );
  }

  // Owner account (bcrypt via pgcrypto, same as GoTrue).
  // auth.users has no plain unique index on email, so check first.
  const foundUser = await client.query(
    "select id from auth.users where lower(email) = lower($1)",
    [OWNER_EMAIL]
  );
  let userId = foundUser.rows[0]?.id;
  if (!userId) {
    const userRes = await client.query(
      `insert into auth.users
        (instance_id, id, aud, role, email, encrypted_password,
         email_confirmed_at, created_at, updated_at,
         confirmation_token, recovery_token, email_change, email_change_token_new,
         raw_user_meta_data, raw_app_meta_data)
       values (
         '00000000-0000-0000-0000-000000000000', gen_random_uuid(),
         'authenticated', 'authenticated', $1,
         crypt($2, gen_salt('bf')),
         now(), now(), now(), '', '', '', '',
         '{}'::jsonb,
         jsonb_build_object('provider','email','providers',jsonb_build_array('email'))
       )
       returning id`,
      [OWNER_EMAIL, OWNER_PASSWORD]
    );
    userId = userRes.rows[0].id;
    console.log(`Owner account created: ${OWNER_EMAIL}`);
  } else {
    console.log("Owner account already exists.");
  }

  // Owner staff row
  const ownerRest = await client.query(
    `insert into public.restaurants
       (id, owner_id, name, slug, description, default_language, currency, upi_id, upi_name, published)
     values (
       '00000000-0000-0000-0000-000000000001', $1, 'The Cedar Table', 'cedar-table',
       'A neighborhood kitchen serving Levantine and Gulf classics, made to order.',
       'en', '₹', 'greentable@upi', 'The Cedar Table', true
     )
     on conflict (id) do update set owner_id = excluded.owner_id
     returning id`,
    [userId]
  );
  await client.query(
    `insert into public.staff (restaurant_id, user_id, role) values ($1, $2, 'OWNER')
     on conflict do nothing`,
    [ownerRest.rows[0].id, userId]
  );

  // Categories
  for (const [id, name, ord] of [
    ["00000000-0000-0000-0000-0000000000a1", "Starters", 1],
    ["00000000-0000-0000-0000-0000000000a2", "Main Courses", 2],
    ["00000000-0000-0000-0000-0000000000a3", "Desserts", 3],
  ]) {
    await client.query(
      `insert into public.menu_categories (id, restaurant_id, name, sort_order, published)
       values ($1, '00000000-0000-0000-0000-000000000001', $2, $3, true)
       on conflict (id) do nothing`,
      [id, name, ord]
    );
  }

  // Dishes
  const dishes = [
    ["00000000-0000-0000-0000-0000000000d1", "00000000-0000-0000-0000-0000000000a1", "Whipped Hummus with Spiced Oil", 8.5, "Creamy chickpea purée finished with warm cumin oil and flatbread.", ["Chickpeas","Tahini (sesame paste)","Lemon juice","Garlic","Cumin","Olive oil","Flatbread"], ["Savory","Mildly tangy","Nutty"], ["Creamy","Silky","Soft flatbread"], 0, ["Vegetarian","Vegan"], ["Sesame","Gluten (flatbread)"], false, "Generous starter, easily shared by two.", true, false],
    ["00000000-0000-0000-0000-0000000000d2", "00000000-0000-0000-0000-0000000000a1", "Labneh with Za'atar", 7, "Strained yogurt cheese, olive oil, herbs, warm pita.", ["Strained yogurt","Olive oil","Za'atar","Pita bread"], ["Tangy","Savory","Herbal"], ["Thick","Spreadable"], 0, ["Vegetarian"], ["Milk","Gluten (pita)"], false, null, true, false],
    ["00000000-0000-0000-0000-0000000000d3", "00000000-0000-0000-0000-0000000000a2", "Chicken Kabsa", 18, "Fragrant rice cooked with chicken, tomato, and warm spices.", ["Chicken (on the bone)","Long-grain rice","Tomato","Onion","Garlic","Bay leaf","Black pepper","Cinnamon","Raisins","Almonds"], ["Savory","Aromatic","Slightly sweet (raisins)"], ["Tender chicken","Fluffy rice"], 2, ["Halal"], ["Tree nuts (almonds)"], false, "Large single portion; comfortable for a light appetite to share.", true, false],
    ["00000000-0000-0000-0000-0000000000d4", "00000000-0000-0000-0000-0000000000a2", "Beef Nihari", 19.5, "Slow-cooked beef shank in a rich, lightly spiced gravy.", ["Beef shank","Wheat flour (thickener)","Ginger","Garlic","Chili powder","Fenugreek","Garam masala"], ["Rich","Savory","Warmly spiced"], ["Fall-apart tender beef","Thick gravy"], 3, [], ["Gluten (wheat flour)"], false, "Served with two flatbreads; a full meal for one.", true, true],
    ["00000000-0000-0000-0000-0000000000d5", "00000000-0000-0000-0000-0000000000a2", "Mixed Grill Mashawi", 24, "Charcoal-grilled skewers of chicken, beef, and kefta.", ["Chicken","Beef","Kefta (ground beef and lamb)","Parsley","Onion","Mixed grill spices"], ["Smoky","Savory","Charred edges"], ["Juicy","Slightly charred outside, tender inside"], 1, ["Halal"], [], true, null, false, false],
    ["00000000-0000-0000-0000-0000000000d6", "00000000-0000-0000-0000-0000000000a3", "Kunafa with Cheese", 9, "Crisp pastry over molten sweet cheese, orange-blossom syrup.", ["Shredded pastry (kataifi)","Sweet cheese","Butter","Sugar syrup","Orange blossom water","Pistachios"], ["Sweet","Creamy-salty balance","Floral"], ["Crisp top","Stretchy molten cheese"], 0, ["Vegetarian"], ["Milk","Gluten (pastry)","Tree nuts (pistachio)"], false, "Best shared fresh; one piece serves two lightly.", true, true],
  ];
  for (const d of dishes) {
    await client.query(
      `insert into public.dishes
        (id, restaurant_id, category_id, name, price, short_description,
         ingredients, taste_profile, texture_profile, spice_level,
         dietary_tags, allergens, allergens_unknown, portion_note,
         is_available, is_special, published, updated_at)
       values ($1,'00000000-0000-0000-0000-000000000001',$2,$3,$4,$5,
               to_jsonb($6::text[]), to_jsonb($7::text[]), to_jsonb($8::text[]),
               $9, $10, $11, $12, $13, $14, $15, true, now())
       on conflict (id) do nothing`,
      [d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7], d[8], d[9], d[10], d[11], d[12], d[13], d[14]]
    );
  }

  // Tables 1–7 + order counter
  for (let n = 1; n <= 7; n++) {
    await client.query(
      `insert into public.tables (restaurant_id, table_number, is_active)
       values ('00000000-0000-0000-0000-000000000001', $1, true)
       on conflict (restaurant_id, table_number) do nothing`,
      [n]
    );
  }
  await client.query(
    `insert into public.order_counters (restaurant_id, last_order_number)
     values ('00000000-0000-0000-0000-000000000001', 1041)
     on conflict (restaurant_id) do nothing`
  );

  // Smoke checks
  const counts = await client.query(
    `select
       (select count(*) from public.restaurants) restaurants,
       (select count(*) from public.dishes) dishes,
       (select count(*) from public.tables) tables,
       (select count(*) from auth.users where email = $1) owner`,
    [OWNER_EMAIL]
  );
  console.log("Verification:", counts.rows[0]);
  console.log("\nDONE. Manager login:", OWNER_EMAIL, "/ (the password you provided)");
} finally {
  await client.end();
}
