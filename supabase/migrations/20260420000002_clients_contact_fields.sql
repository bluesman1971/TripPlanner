-- Sprint 2: add contact fields to clients table
-- All fields optional — consultant fills in what they have

alter table clients
  add column if not exists phone        text not null default '',
  add column if not exists address_line text not null default '',
  add column if not exists city         text not null default '',
  add column if not exists country      text not null default '',
  add column if not exists postal_code  text not null default '';

comment on column clients.phone        is 'Primary contact phone number';
comment on column clients.address_line is 'Street address line';
comment on column clients.city         is 'City';
comment on column clients.country      is 'Country';
comment on column clients.postal_code  is 'Postal / ZIP code';
