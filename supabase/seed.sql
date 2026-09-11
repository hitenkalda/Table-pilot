-- Demo seed for local development. Replace :OWNER_ID with an auth.users id.
insert into public.restaurants (id, owner_id, name, slug, description, default_language, published)
values (
  '00000000-0000-0000-0000-000000000001',
  :OWNER_ID,
  'The Cedar Table',
  'cedar-table',
  'A neighborhood kitchen serving Levantine and Gulf classics, made to order.',
  'en',
  true
);

insert into public.menu_categories (id, restaurant_id, name, sort_order, published) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'Starters', 1, true),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001', 'Main Courses', 2, true),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000001', 'Desserts', 3, true);

insert into public.dishes (
  id, restaurant_id, category_id, name, price, short_description,
  ingredients, taste_profile, texture_profile, spice_level,
  dietary_tags, allergens, allergens_unknown, portion_note,
  is_available, published
) values (
  '00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-0000000000a1',
  'Whipped Hummus with Spiced Oil',
  8.50,
  'Creamy chickpea purée finished with warm cumin oil and flatbread.',
  '["Chickpeas","Tahini (sesame paste)","Lemon juice","Garlic","Cumin","Olive oil","Flatbread"]',
  '["Savory","Mildly tangy","Nutty"]',
  '["Creamy","Silky","Soft flatbread"]',
  0,
  '{Vegetarian,Vegan}',
  '{Sesame,"Gluten (flatbread)"}',
  false,
  'Generous starter, easily shared by two.',
  true,
  true
);
