-- One-time setup on a new machine: creates the app role and database.
-- Run through `npm run db:create`, which passes the password from DATABASE_URL.
CREATE ROLE ahan_app WITH LOGIN PASSWORD :'app_password';
CREATE DATABASE ahanportal OWNER ahan_app ENCODING 'UTF8' TEMPLATE template0;
