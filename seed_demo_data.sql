-- Demo company fake data — Ops
-- Generated for demo/sales purposes. Run in the Supabase SQL editor.
-- 8 vehicles (mix of self-serviced and workshop-serviced), diesel/petrol
-- logs across all 3 locations, parts inventory, and a handful of repairs.

insert into fleet (id, company_id, name, category, fuel, license_expiry, last_service_date, last_service_km, service_interval_months, service_interval_km, self_serviced, service_location_id) values
  ('BCJ 418 L', (select id from companies where slug = 'demo'), 'Land Cruiser 1', 'Game Drive Vehicle', 'diesel', '06/10/2026', '06/03/2026', 73522, 6, 10000, true, 'SC'),
  ('BCK 902 L', (select id from companies where slug = 'demo'), 'Land Cruiser 2', 'Game Drive Vehicle', 'diesel', '04/08/2026', '28/04/2026', 66593, 6, 10000, true, 'ZC'),
  ('BDF 275 L', (select id from companies where slug = 'demo'), 'Hilux Support', 'Support Vehicle', 'diesel', '28/10/2026', '02/03/2026', 53552, 6, 10000, false, null),
  ('BCR 731 L', (select id from companies where slug = 'demo'), 'Quantum Shuttle', 'Transfer Vehicle', 'diesel', '10/02/2027', '15/04/2026', 105698, 6, 10000, false, null),
  ('CART 01', (select id from companies where slug = 'demo'), 'Golf Cart 1', 'Utility', 'petrol', '13/03/2027', '21/03/2026', 48919, 6, 10000, true, 'EC'),
  ('CART 02', (select id from companies where slug = 'demo'), 'Golf Cart 2', 'Utility', 'petrol', '17/10/2026', '31/01/2026', 78465, 6, 10000, true, 'ZC'),
  ('TRACTOR 01', (select id from companies where slug = 'demo'), 'Tractor', 'Grounds', 'diesel', '03/02/2027', '21/01/2026', 39442, 6, 10000, false, null),
  ('BDL 664 L', (select id from companies where slug = 'demo'), 'Generator Bakkie', 'Support Vehicle', 'petrol', '09/04/2027', '19/04/2026', 43791, 6, 10000, false, null);


insert into diesel_deliveries (id, location_id, company_id, date, litres, price_per_litre, supplier, invoice_no, notes) values
  ('3d3f38dd-6c98-4fb0-a814-518f0ccd6fc8', 'ZC', (select id from companies where slug = 'demo'), '2026-06-08', 257.4, 23.13, 'Bushveld Fuels', 'INV-69640', null),
  ('0675b504-6c4d-43f1-9116-04858d01fbed', 'ZC', (select id from companies where slug = 'demo'), '2026-07-06', 217.8, 23.72, 'Bushveld Fuels', 'INV-23443', null),
  ('0befcd0b-29ec-4371-9fab-9c7f2a543327', 'ZC', (select id from companies where slug = 'demo'), '2026-07-20', 582.6, 22.41, 'Bushveld Fuels', 'INV-19999', null),
  ('c0acd808-5dec-4c44-becf-0a80f0ff47b8', 'EC', (select id from companies where slug = 'demo'), '2026-06-01', 534.1, 23.76, 'Bushveld Fuels', 'INV-65191', null),
  ('8bd208a4-8009-45be-a4b4-48edf4e9fb00', 'EC', (select id from companies where slug = 'demo'), '2026-06-08', 437.6, 21.79, 'Bushveld Fuels', 'INV-29252', null),
  ('2c182cc2-fdca-44a0-a80b-3bf76899eda0', 'EC', (select id from companies where slug = 'demo'), '2026-06-22', 369.4, 25.74, 'Bushveld Fuels', 'INV-69545', null),
  ('90d7cf0a-f0ea-4834-9f78-86f0cdb7cf15', 'EC', (select id from companies where slug = 'demo'), '2026-07-13', 295.8, 21.81, 'Bushveld Fuels', 'INV-23954', null),
  ('84728a99-c9ab-4f1e-99dc-6c6ec3c1d165', 'EC', (select id from companies where slug = 'demo'), '2026-08-03', 547.5, 21.19, 'Bushveld Fuels', 'INV-31131', null),
  ('9b46adcc-7f7b-40c1-bf73-968d20f4c7b4', 'SC', (select id from companies where slug = 'demo'), '2026-06-15', 480.9, 23.38, 'Bushveld Fuels', 'INV-46487', null),
  ('bdf5038a-b7c5-45c9-b7ea-ab074c004ae7', 'SC', (select id from companies where slug = 'demo'), '2026-06-22', 523.4, 24.95, 'Bushveld Fuels', 'INV-72050', null),
  ('46956d3b-a61b-4dbe-ac55-8b9e09bd88e4', 'SC', (select id from companies where slug = 'demo'), '2026-07-06', 475.5, 21.8, 'Bushveld Fuels', 'INV-67250', null),
  ('a55dd328-b7a2-46fb-9455-7f27a4b278e6', 'SC', (select id from companies where slug = 'demo'), '2026-07-13', 558.6, 25.67, 'Bushveld Fuels', 'INV-75463', null);


insert into diesel_issues (id, location_id, company_id, date, open_meter, close_meter, litres, vehicle_id, mileage, notes) values
  ('4c499eb7-f0fa-4276-8301-d18854bf2b00', 'ZC', (select id from companies where slug = 'demo'), '2026-06-15', 1678.5, 1784.9, 26.6, 'BCJ 418 L', 104473, null),
  ('ebd4b621-ad57-4429-bcd1-aa31faf0c879', 'ZC', (select id from companies where slug = 'demo'), '2026-06-29', 1791.1, 1986.3, 48.8, 'BCK 902 L', 78238, null),
  ('247f9642-c03f-4440-8051-89134de7234e', 'ZC', (select id from companies where slug = 'demo'), '2026-07-06', 2009.7, 2123.7, 28.5, 'BCR 731 L', 23145, null),
  ('cfbefa78-f4cb-4a9c-9722-e228304389b7', 'ZC', (select id from companies where slug = 'demo'), '2026-07-20', 2159.1, 2325.5, 41.6, 'BCJ 418 L', 31115, null),
  ('6aec6d93-3bdd-4c77-8a60-864843e859b5', 'ZC', (select id from companies where slug = 'demo'), '2026-07-27', 2301.0, 2531.0, 57.5, 'BDF 275 L', 33621, null),
  ('16985820-6e1f-479f-bc8c-cb234abc5bc0', 'EC', (select id from companies where slug = 'demo'), '2026-06-01', 1540.4, 1634.0, 23.4, 'BCK 902 L', 111197, null),
  ('7948a686-619c-4721-a514-c47efae0cf88', 'EC', (select id from companies where slug = 'demo'), '2026-06-08', 1600.2, 1739.0, 34.7, 'BCJ 418 L', 74590, null),
  ('a44b6301-dc53-48a6-889c-408d2ad32df0', 'EC', (select id from companies where slug = 'demo'), '2026-06-15', 1731.9, 1985.5, 63.4, 'BCR 731 L', 104521, null),
  ('41b5b78b-071d-4395-9b12-33aea836d2ff', 'EC', (select id from companies where slug = 'demo'), '2026-06-22', 1985.8, 2286.2, 75.1, 'BDF 275 L', 112976, null),
  ('bff00014-57e3-4b96-9bcc-a0d589b4682f', 'EC', (select id from companies where slug = 'demo'), '2026-06-29', 2265.3, 2397.7, 33.1, 'BCJ 418 L', 117779, null),
  ('486d5337-51a3-47c9-8943-974b772cf4ef', 'EC', (select id from companies where slug = 'demo'), '2026-07-06', 2415.8, 2535.4, 29.9, 'BCR 731 L', 104757, null),
  ('df9131bb-b89b-46cd-a281-97ccef7f9518', 'EC', (select id from companies where slug = 'demo'), '2026-07-13', 2552.4, 2635.2, 20.7, 'TRACTOR 01', 44607, null),
  ('e3095fb2-53ed-4323-becd-3e5b90500480', 'EC', (select id from companies where slug = 'demo'), '2026-07-20', 2626.7, 2717.5, 22.7, 'BCR 731 L', 60449, null),
  ('4602b997-a2ff-44f8-8827-083ba022a727', 'EC', (select id from companies where slug = 'demo'), '2026-08-03', 2723.8, 2822.6, 24.7, 'BCR 731 L', 114170, null),
  ('44b6c60b-90c8-45b2-bc79-89c7a7cd0c7e', 'SC', (select id from companies where slug = 'demo'), '2026-06-01', 1070.2, 1287.0, 54.2, 'BCK 902 L', 49235, null),
  ('920a51a9-b8dc-4ee7-a64b-c3253e5cd912', 'SC', (select id from companies where slug = 'demo'), '2026-06-08', 1262.8, 1386.0, 30.8, 'BCJ 418 L', 72028, null),
  ('d4e44265-3e84-442c-ac2f-d0e02d5fc146', 'SC', (select id from companies where slug = 'demo'), '2026-06-15', 1384.3, 1501.5, 29.3, 'TRACTOR 01', 103914, null),
  ('2ea0b82c-2a45-48b3-8ed1-8c8963933193', 'SC', (select id from companies where slug = 'demo'), '2026-06-22', 1566.7, 1855.1, 72.1, 'BCK 902 L', 109610, null),
  ('aeab458e-c9d1-42b2-8211-ef0fb35d4ee1', 'SC', (select id from companies where slug = 'demo'), '2026-06-29', 1827.5, 1951.5, 31.0, 'BDF 275 L', 76168, null),
  ('e7205086-ecbc-47b8-87ad-65cb2091ccd1', 'SC', (select id from companies where slug = 'demo'), '2026-07-06', 1909.0, 2082.2, 43.3, 'TRACTOR 01', 98266, null),
  ('6f883a91-1c9c-4680-b9a3-9e805b7749e5', 'SC', (select id from companies where slug = 'demo'), '2026-07-20', 2067.7, 2170.9, 25.8, 'TRACTOR 01', 44596, null);


insert into diesel_dips (id, location_id, company_id, date, litres, notes) values
  ('4c6fc8cf-4db3-4718-8b1d-5e13ca0b4985', 'ZC', (select id from companies where slug = 'demo'), '2026-06-01', 305.1, null),
  ('f1f98fef-4a6e-411b-99c6-c8b342e5cacf', 'ZC', (select id from companies where slug = 'demo'), '2026-06-22', 585.4, null),
  ('a749c25d-e0f5-42af-b43c-36b476e440ed', 'ZC', (select id from companies where slug = 'demo'), '2026-07-06', 362.0, null),
  ('57b92448-1971-4e31-8496-5e8f0badeab7', 'ZC', (select id from companies where slug = 'demo'), '2026-07-27', 424.6, null),
  ('38f2b7c4-c19f-4510-8126-a162f1a635be', 'EC', (select id from companies where slug = 'demo'), '2026-06-08', 250.3, null),
  ('ac137f47-8dbe-4398-ac50-b273feaa9b8d', 'EC', (select id from companies where slug = 'demo'), '2026-06-22', 662.3, null),
  ('cc7f4789-4b33-4e5a-a03e-fb30f8b27bfb', 'EC', (select id from companies where slug = 'demo'), '2026-07-20', 346.2, null),
  ('b1204cea-ff8e-47a9-90fa-1e4ecf630285', 'EC', (select id from companies where slug = 'demo'), '2026-08-03', 268.6, null),
  ('ba1c2613-2562-4723-9bfe-40a069df7f50', 'SC', (select id from companies where slug = 'demo'), '2026-06-15', 462.5, null),
  ('fe2d4237-3ae3-4016-85ca-7d632409beb7', 'SC', (select id from companies where slug = 'demo'), '2026-07-06', 547.5, null),
  ('41c5c198-78ec-4fa5-b784-4eb8fb4565c0', 'SC', (select id from companies where slug = 'demo'), '2026-07-13', 683.5, null);


insert into diesel_opening (location_id, company_id, litres, updated_at) values
  ('ZC', (select id from companies where slug = 'demo'), 475.6, '2026-06-01T00:00:00'),
  ('EC', (select id from companies where slug = 'demo'), 709.6, '2026-06-01T00:00:00'),
  ('SC', (select id from companies where slug = 'demo'), 346.9, '2026-06-01T00:00:00');


insert into petrol_purchases (id, location_id, company_id, date, litres, price_per_litre, station, notes) values
  ('768cd87f-cb83-4ed2-9e25-04f5a05170fb', 'ZC', (select id from companies where slug = 'demo'), '2026-06-01', 92.0, 26.09, 'Engen Local', null),
  ('29b66455-d5d1-49bf-a134-b965f0d51b60', 'ZC', (select id from companies where slug = 'demo'), '2026-06-08', 66.9, 25.63, 'Engen Local', null),
  ('9ab6aade-1580-42e0-ad6c-fbae952de5b1', 'ZC', (select id from companies where slug = 'demo'), '2026-06-15', 83.9, 23.34, 'Engen Local', null),
  ('412d71ec-03c4-4165-9390-0e4438c23730', 'ZC', (select id from companies where slug = 'demo'), '2026-06-29', 63.5, 23.22, 'Engen Local', null),
  ('06995afe-dc27-493f-ae58-ea6575e57109', 'ZC', (select id from companies where slug = 'demo'), '2026-07-06', 50.1, 26.61, 'Engen Local', null),
  ('845f5311-c9af-4117-af40-b05003c1693b', 'ZC', (select id from companies where slug = 'demo'), '2026-07-27', 48.6, 26.53, 'Engen Local', null),
  ('3f7562f0-bc2c-4786-8295-02e3f5f17bc7', 'EC', (select id from companies where slug = 'demo'), '2026-06-01', 31.8, 26.82, 'Engen Local', null),
  ('d777e163-ad1e-4484-abd2-067f0020bd1f', 'EC', (select id from companies where slug = 'demo'), '2026-06-15', 40.9, 26.41, 'Engen Local', null),
  ('0e73c4ce-20f9-4740-a3c9-f9d6aedeb330', 'EC', (select id from companies where slug = 'demo'), '2026-06-22', 36.4, 23.89, 'Engen Local', null),
  ('8667db8a-59fa-4221-9b8f-359ae88f385c', 'EC', (select id from companies where slug = 'demo'), '2026-07-06', 37.3, 23.81, 'Engen Local', null),
  ('834a709d-9a33-4514-bf7f-17fe66d61edc', 'EC', (select id from companies where slug = 'demo'), '2026-07-20', 57.9, 22.97, 'Engen Local', null),
  ('07c08396-f133-4f99-b3f6-8f6b1280f518', 'EC', (select id from companies where slug = 'demo'), '2026-07-27', 58.5, 25.71, 'Engen Local', null),
  ('4d336fa5-dd7c-4bc4-9e22-c136f9e63892', 'SC', (select id from companies where slug = 'demo'), '2026-06-08', 53.0, 23.59, 'Engen Local', null),
  ('f5a7a818-fb37-487b-a3f8-c4d433e9e5e6', 'SC', (select id from companies where slug = 'demo'), '2026-06-22', 42.3, 22.71, 'Engen Local', null),
  ('32fc104b-9b35-4c88-bbc5-36898102d392', 'SC', (select id from companies where slug = 'demo'), '2026-07-27', 87.0, 22.08, 'Engen Local', null);


insert into petrol_issues (id, location_id, company_id, date, litres, vehicle_id, mileage, notes) values
  ('88a2aa6b-927e-42a2-9716-996b0d211007', 'ZC', (select id from companies where slug = 'demo'), '2026-06-29', 17.5, 'CART 02', 5032, null),
  ('d7202365-c304-45e1-8a66-f7783cbd4131', 'ZC', (select id from companies where slug = 'demo'), '2026-07-20', 11.7, 'BDL 664 L', 6942, null),
  ('5ef2ded2-b5fc-4c44-84d3-7096f374d2f9', 'ZC', (select id from companies where slug = 'demo'), '2026-08-03', 12.8, 'CART 01', 16677, null),
  ('cd0db292-81f1-4252-8626-492d27801d4a', 'EC', (select id from companies where slug = 'demo'), '2026-06-01', 7.1, 'BDL 664 L', 3417, null),
  ('126266b3-f72d-4433-9ea7-a40f932fec47', 'EC', (select id from companies where slug = 'demo'), '2026-06-15', 15.1, 'CART 01', 1356, null),
  ('4d762dcb-3e6d-4334-bf51-5702fd893790', 'EC', (select id from companies where slug = 'demo'), '2026-06-29', 14.4, 'BDL 664 L', 11262, null),
  ('799e21ee-d53b-48ed-924c-a14254e9e6bc', 'EC', (select id from companies where slug = 'demo'), '2026-07-13', 6.7, 'CART 02', 19681, null),
  ('10e3c9c9-f796-444e-ad9a-970dddb9075e', 'EC', (select id from companies where slug = 'demo'), '2026-07-27', 5.5, 'CART 01', 13521, null),
  ('bada0cae-1976-44ba-96ce-cec67d8d306a', 'EC', (select id from companies where slug = 'demo'), '2026-08-03', 8.2, 'BDL 664 L', 17437, null),
  ('186818af-923c-4dc9-bf3a-eb95fd908c70', 'SC', (select id from companies where slug = 'demo'), '2026-06-01', 14.4, 'CART 02', 18534, null),
  ('8bc61270-27ae-4cbb-a26c-58a4bef54fb5', 'SC', (select id from companies where slug = 'demo'), '2026-06-22', 11.0, 'CART 01', 15792, null),
  ('01e1ba41-87f4-46c3-8b6a-e631745d6c8a', 'SC', (select id from companies where slug = 'demo'), '2026-06-29', 23.8, 'CART 02', 16781, null),
  ('0576134a-302b-4a6b-ad88-bd5c6d86ff19', 'SC', (select id from companies where slug = 'demo'), '2026-07-06', 24.7, 'BDL 664 L', 11371, null),
  ('5c37140b-f83d-4bba-8ce2-631676e7737c', 'SC', (select id from companies where slug = 'demo'), '2026-07-13', 24.8, 'CART 01', 5119, null),
  ('7757ba1a-ffab-4861-b1e5-f7701564aaa5', 'SC', (select id from companies where slug = 'demo'), '2026-07-20', 9.3, 'CART 02', 7873, null),
  ('8b38a466-61e8-46af-8bc2-d0d0674a41b8', 'SC', (select id from companies where slug = 'demo'), '2026-08-03', 12.0, 'CART 02', 18775, null);


insert into petrol_opening (location_id, company_id, litres, updated_at) values
  ('ZC', (select id from companies where slug = 'demo'), 259.4, '2026-06-01T00:00:00'),
  ('EC', (select id from companies where slug = 'demo'), 251.3, '2026-06-01T00:00:00'),
  ('SC', (select id from companies where slug = 'demo'), 260.7, '2026-06-01T00:00:00');


insert into parts (id, location_id, company_id, description, storeroom, shelf, position, unit, open_cost, open_qty, purchase_qty, purchase_cost, purchase_from, closing_qty, issues) values
  ('bfbd5887-c6f6-4a94-8071-595243481435', 'ZC', (select id from companies where slug = 'demo'), 'Oil Filter', 'A', null, null, 'each', 430.51, 4, 2, 675.9, 'Midas', 1, '{}'),
  ('7a163822-c1b7-4156-bd21-2d345659da57', 'ZC', (select id from companies where slug = 'demo'), 'Brake Pads', 'A', null, null, 'set', 485.25, 9, 4, 474.66, 'Midas', 10, '{}'),
  ('f2746bc8-9994-4e74-8301-0347fff8e631', 'ZC', (select id from companies where slug = 'demo'), 'Fan Belt', 'A', null, null, 'each', 353.44, 12, 8, 737.76, 'Midas', 14, '{}'),
  ('69d85304-c78d-48f8-859a-fe47b078c829', 'ZC', (select id from companies where slug = 'demo'), 'Wiper Blades', 'A', null, null, 'pair', 530.46, 6, 5, 521.77, 'Midas', 7, '{}'),
  ('17f68a4f-22b1-44db-b896-97cd3067bf32', 'ZC', (select id from companies where slug = 'demo'), 'Air Filter', 'A', null, null, 'each', 512.1, 12, 7, 716.81, 'Midas', 15, '{}'),
  ('fa94775d-a83b-4676-aa4d-54c962c90b60', 'ZC', (select id from companies where slug = 'demo'), 'Spark Plugs', 'A', null, null, 'set', 272.86, 6, 7, 82.35, 'Midas', 12, '{}'),
  ('cfce38f7-dd2a-4c75-80bd-41f0efa58e3c', 'EC', (select id from companies where slug = 'demo'), 'Oil Filter', 'A', null, null, 'each', 614.14, 11, 7, 842.79, 'Midas', 13, '{}'),
  ('349a8409-7d4a-4afe-acb9-f883b6c8f62d', 'EC', (select id from companies where slug = 'demo'), 'Brake Pads', 'A', null, null, 'set', 112.81, 8, 6, 664.47, 'Midas', 10, '{}'),
  ('6ede8f8f-059d-4a05-8efa-16ab2435885f', 'EC', (select id from companies where slug = 'demo'), 'Fan Belt', 'A', null, null, 'each', 577.64, 6, 3, 865.57, 'Midas', 4, '{}'),
  ('a5d14267-8de1-4a85-a335-3f8eb5f30ab3', 'EC', (select id from companies where slug = 'demo'), 'Wiper Blades', 'A', null, null, 'pair', 528.65, 5, 8, 874.54, 'Midas', 10, '{}'),
  ('fd4cdade-dbbe-43ac-ae5e-2ddc547a13e2', 'EC', (select id from companies where slug = 'demo'), 'Air Filter', 'A', null, null, 'each', 452.94, 4, 5, 219.17, 'Midas', 8, '{}'),
  ('bb9515f9-cc0f-4ed2-bd45-659c1383b002', 'EC', (select id from companies where slug = 'demo'), 'Spark Plugs', 'A', null, null, 'set', 226.93, 8, 2, 712.99, 'Midas', 9, '{}'),
  ('b61317ff-4cce-49b5-8e1d-700312d9851e', 'SC', (select id from companies where slug = 'demo'), 'Oil Filter', 'A', null, null, 'each', 172.97, 9, 6, 224.17, 'Midas', 12, '{}'),
  ('069df984-e86b-4317-ad9f-f759ea2c82d0', 'SC', (select id from companies where slug = 'demo'), 'Brake Pads', 'A', null, null, 'set', 644.61, 9, 4, 438.74, 'Midas', 7, '{}'),
  ('376e6296-f5f0-4f46-9963-a71d8429450e', 'SC', (select id from companies where slug = 'demo'), 'Fan Belt', 'A', null, null, 'each', 585.33, 4, 7, 417.25, 'Midas', 10, '{}'),
  ('78875c9c-306a-4e16-9cd5-f803dbe725e8', 'SC', (select id from companies where slug = 'demo'), 'Wiper Blades', 'A', null, null, 'pair', 253.73, 7, 8, 717.04, 'Midas', 11, '{}'),
  ('e2a7db30-2305-47f1-aafa-ba010c928ebb', 'SC', (select id from companies where slug = 'demo'), 'Air Filter', 'A', null, null, 'each', 418.61, 4, 4, 752.74, 'Midas', 4, '{}'),
  ('f3ba41a6-b764-4a84-ad0f-a897a4767fe5', 'SC', (select id from companies where slug = 'demo'), 'Spark Plugs', 'A', null, null, 'set', 721.4, 9, 2, 496.2, 'Midas', 8, '{}');


insert into parts_issues (id, location_id, company_id, part_id, vehicle_id, date, qty, notes) values
  ('36086d6e-b340-4a84-be1b-ffadfbf27526', 'ZC', (select id from companies where slug = 'demo'), 'bfbd5887-c6f6-4a94-8071-595243481435', 'CART 01', '2026-06-17', 1, null),
  ('f9bc9fae-a2a8-45a6-aa53-3a36576be25e', 'ZC', (select id from companies where slug = 'demo'), '69d85304-c78d-48f8-859a-fe47b078c829', 'BCR 731 L', '2026-07-20', 1, null),
  ('25feffd5-1350-4a0c-9da9-489f32fada85', 'EC', (select id from companies where slug = 'demo'), 'cfce38f7-dd2a-4c75-80bd-41f0efa58e3c', 'BDF 275 L', '2026-07-14', 2, null),
  ('fe7c55c2-77e6-49ad-afcf-c173ddae061d', 'EC', (select id from companies where slug = 'demo'), '6ede8f8f-059d-4a05-8efa-16ab2435885f', 'BDL 664 L', '2026-06-13', 1, null),
  ('c9bd0112-58c7-4ad4-b12f-7eb4f947dca7', 'EC', (select id from companies where slug = 'demo'), 'fd4cdade-dbbe-43ac-ae5e-2ddc547a13e2', 'BCK 902 L', '2026-07-06', 2, null),
  ('df70e8ca-b9ca-4cf9-a2af-1178d24375b2', 'EC', (select id from companies where slug = 'demo'), 'bb9515f9-cc0f-4ed2-bd45-659c1383b002', 'BDL 664 L', '2026-07-03', 2, null),
  ('818e89ac-d7de-48b9-bc12-36494d77581e', 'SC', (select id from companies where slug = 'demo'), 'b61317ff-4cce-49b5-8e1d-700312d9851e', 'BDF 275 L', '2026-06-21', 2, null),
  ('16421733-decb-4c03-9559-d567fafb1756', 'SC', (select id from companies where slug = 'demo'), '069df984-e86b-4317-ad9f-f759ea2c82d0', 'BCK 902 L', '2026-06-12', 1, null),
  ('477989ad-e209-40f8-9428-088d2b65ddf7', 'SC', (select id from companies where slug = 'demo'), '376e6296-f5f0-4f46-9963-a71d8429450e', 'BCK 902 L', '2026-07-27', 1, null),
  ('32b87561-542c-4106-8966-c0438c1549e5', 'SC', (select id from companies where slug = 'demo'), '78875c9c-306a-4e16-9cd5-f803dbe725e8', 'BCK 902 L', '2026-06-26', 2, null),
  ('4903bc3e-993d-4512-9839-d315855cdce5', 'SC', (select id from companies where slug = 'demo'), 'f3ba41a6-b764-4a84-ad0f-a897a4767fe5', 'TRACTOR 01', '2026-07-10', 2, null);


insert into repairs (id, location_id, company_id, date, vehicle_id, workshop, invoice_no, description, labour_cost, parts_cost, other_cost, total_cost, invoice_received, notes) values
  ('b583a306-f227-4e06-99e0-f6a65a302a1f', 'ZC', (select id from companies where slug = 'demo'), '2026-07-31', 'CART 02', 'Local Motors', 'WS-1976', 'Suspension work', 1449.14, 1857.63, 0, 3306.77, true, null),
  ('9d02e545-e5d3-4746-bcc7-4d8d961e1071', 'EC', (select id from companies where slug = 'demo'), '2026-06-16', 'BDF 275 L', 'Local Motors', 'WS-6955', 'Suspension work', 1466.02, 1078.87, 0, 2544.89, true, null),
  ('e88aab20-f21f-4093-8153-e2664bbeef3b', 'EC', (select id from companies where slug = 'demo'), '2026-07-27', 'BDF 275 L', 'Local Motors', 'WS-6138', 'Suspension work', 740.08, 1720.7, 0, 2460.78, true, null),
  ('4ab8eec2-63e3-42ed-b9ea-ae6403a692c4', 'EC', (select id from companies where slug = 'demo'), '2026-08-04', 'TRACTOR 01', 'Local Motors', 'WS-1699', 'Brake service', 840.11, 1779.34, 0, 2619.45, true, null),
  ('b716fb41-f4f8-413f-b1fa-7622699c392b', 'SC', (select id from companies where slug = 'demo'), '2026-06-01', 'BCR 731 L', 'Local Motors', 'WS-1254', 'Brake service', 1380.22, 946.2, 0, 2326.42, true, null),
  ('98c53e3e-0287-4e8b-91b8-b06fb6c80893', 'SC', (select id from companies where slug = 'demo'), '2026-08-06', 'CART 02', 'Local Motors', 'WS-6490', 'Clutch repair', 1284.04, 1279.9, 0, 2563.94, false, null),
  ('35b46f7b-b0ad-45f8-b80d-96f38aa3dfbe', 'SC', (select id from companies where slug = 'demo'), '2026-07-01', 'TRACTOR 01', 'Local Motors', 'WS-7444', 'Brake service', 966.89, 904.45, 0, 1871.34, false, null);

-- Verification:
select 'fleet' as t, count(*) from fleet where company_id = (select id from companies where slug='demo')
union all select 'diesel_deliveries', count(*) from diesel_deliveries where company_id = (select id from companies where slug='demo')
union all select 'repairs', count(*) from repairs where company_id = (select id from companies where slug='demo');
