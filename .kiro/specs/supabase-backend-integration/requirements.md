# Requirements Document

## Introduction

This document specifies the requirements for the **Supabase Backend Integration** foundation phase of Kapanin, a decision-support system for small retail store owners (UMKM). This phase delivers a stateless Node.js + Express + TypeScript API service backed by Supabase (managed Postgres + Supabase Auth). It provides authenticated, owner-scoped CRUD over the core retail data (products, stock, sales, discounts) that later phases will build on.

Requirements are derived from the approved design document. The frontend application and the AI/recommendation engine are explicitly out of scope for this phase; they appear only where they constrain the backend contract (for example, the Bearer-JWT request contract). The three governing pillars — security, testability, and portability — are reflected throughout.

## Glossary

- **Backend_Service**: The Node.js + Express + TypeScript API service delivered in this phase.
- **Config_Loader**: The component that parses and validates environment configuration at startup and constructs the Supabase client (`loadConfig`, `createSupabaseClient`).
- **Auth_Middleware**: The Express middleware that verifies the Supabase JWT and attaches the authenticated owner to the request.
- **Error_Handler**: The centralized error-handling middleware that maps error types to HTTP status codes.
- **Product_Service**: The service-layer component providing owner-scoped CRUD over products; the reusable template for stock, sales, and discounts services.
- **Owner**: An authenticated user represented by a row in `auth.users`; identified in a verified JWT by the `sub` claim and in data tables by `owner_id`.
- **JWT**: The short-lived JSON Web Token issued by Supabase Auth and presented as `Authorization: Bearer <jwt>`.
- **JWKS**: The Supabase project's JSON Web Key Set endpoint used to verify JWT signatures with asymmetric keys.
- **RLS**: Postgres Row Level Security; the authoritative data-layer enforcement of owner scoping (`owner_id = auth.uid()`).
- **Secret_Key**: The server-only Supabase secret key used to construct the Supabase client; never logged or returned.
- **Data_Table**: Any of the owner-scoped tables `products`, `stock`, `sales`, `discounts`.
- **Profile**: The `profiles` row that is 1:1 with an `auth.users` row and auto-created on signup.
- **Migration_File**: A SQL file in the repository that defines schema, constraints, triggers, or RLS policies.

## Requirements

### Requirement 1: Environment Configuration and Supabase Client Construction

**User Story:** As a backend developer, I want environment configuration validated at startup and the Supabase client built from a server-only secret, so that the service fails fast on misconfiguration and never leaks privileged credentials.

#### Acceptance Criteria

1. WHEN `loadConfig` is called with an environment that contains all required variables in valid form, THE Config_Loader SHALL return a frozen typed configuration object.
2. IF a required environment variable is missing or invalid, THEN THE Config_Loader SHALL throw a descriptive error naming the offending variable and SHALL NOT include the variable value in the error.
3. WHILE `loadConfig` executes, THE Config_Loader SHALL perform no I/O and SHALL NOT mutate the provided environment object.
4. WHEN a required environment variable is missing or invalid, THE Backend_Service SHALL NOT start the HTTP application.
5. THE Config_Loader SHALL construct the Supabase client using the server-only Secret_Key.
6. THE Backend_Service SHALL exclude the Secret_Key from logs and from all HTTP responses.
7. THE Backend_Service SHALL provide an `.env.example` file that contains placeholder values only and SHALL keep real secret files git-ignored.

### Requirement 2: JWT Authentication via JWKS

**User Story:** As a store owner, I want the backend to verify my Supabase token on every protected request, so that only authenticated owners can access protected resources.

#### Acceptance Criteria

1. WHEN a request to a protected route carries a valid, unexpired, correctly-signed Bearer JWT, THE Auth_Middleware SHALL populate the request with the authenticated Owner derived from the token `sub` claim and SHALL pass control to the route handler.
2. IF a request to a protected route has no `Authorization` header or a header that does not begin with `Bearer `, THEN THE Auth_Middleware SHALL respond with status `401` and SHALL NOT pass control to the route handler.
3. IF a request to a protected route carries a malformed JWT or a JWT with an invalid signature, THEN THE Auth_Middleware SHALL respond with status `401`.
4. IF a request to a protected route carries an expired JWT, THEN THE Auth_Middleware SHALL respond with status `401`.
5. IF a verified JWT lacks a `sub` claim, THEN THE Auth_Middleware SHALL respond with status `401`.
6. THE Auth_Middleware SHALL verify JWT signatures against the remote JWKS using asymmetric keys.
7. WHEN authentication fails, THE Backend_Service SHALL perform no database write for that request.

### Requirement 3: Core Data Model, Constraints, and Portable Migrations

**User Story:** As a backend developer, I want the retail data model expressed as SQL migrations with integrity constraints, so that the schema is portable and enforces valid data at the database layer.

#### Acceptance Criteria

1. THE Backend_Service SHALL define the schema for `profiles`, `products`, `stock`, `sales`, and `discounts` as SQL Migration_Files stored in the repository.
2. THE Backend_Service SHALL assign a UUID primary key to each row of every Data_Table, and SHALL set `profiles.id` equal to the corresponding `auth.users.id`.
3. THE Backend_Service SHALL define `owner_id` on every Data_Table as a foreign key referencing `auth.users(id)` with `on delete cascade`.
4. IF a `stock`, `sales`, or `discounts` insert or update supplies a `quantity` less than `0`, THEN THE Backend_Service SHALL reject the operation with a `4xx` status and SHALL write no row.
5. IF a `discounts` insert or update supplies a `percentage` outside the range greater than `0` and less than or equal to `100`, THEN THE Backend_Service SHALL reject the operation with a `4xx` status and SHALL write no row.
6. IF a `products` insert or update supplies a `price` less than `0` or a `cost` less than `0`, THEN THE Backend_Service SHALL reject the operation with a `4xx` status and SHALL write no row.
7. IF a `discounts` insert or update supplies an `end_date` earlier than its `start_date`, THEN THE Backend_Service SHALL reject the operation with a `4xx` status and SHALL write no row.
8. THE Backend_Service SHALL set `created_at` and `updated_at` timestamps on applicable rows and SHALL maintain `updated_at` on update.

### Requirement 4: Profile Auto-Creation on Signup

**User Story:** As a store owner, I want a profile created automatically when I sign up, so that my account has an owner profile without a separate setup step.

#### Acceptance Criteria

1. WHEN a new row is inserted into `auth.users`, THE Backend_Service SHALL create a corresponding Profile whose `id` equals the new user's id.
2. THE Backend_Service SHALL maintain a one-to-one relationship between each `auth.users` row and its Profile.

### Requirement 5: Owner Isolation Across Service and RLS Layers

**User Story:** As a store owner, I want to access only my own data, so that no other owner can read or modify my records even if the application layer has a bug.

#### Acceptance Criteria

1. WHEN an Owner requests a list or a single record from a Data_Table, THE Backend_Service SHALL return only rows whose `owner_id` equals that Owner's id.
2. WHEN any create operation on a Data_Table succeeds, THE Backend_Service SHALL set the created row's `owner_id` to the authenticated Owner's id.
3. THE Backend_Service SHALL enforce owner scoping in the service layer by constraining every query with `owner_id = <authenticated owner id>`.
4. THE Backend_Service SHALL enable RLS on every Data_Table with policies that restrict access to rows where `owner_id = auth.uid()`.
5. WHILE an Owner is authenticated, THE Backend_Service SHALL prevent that Owner from reading, updating, or deleting a record owned by a different Owner.

### Requirement 6: Foreign-Key Owner Integrity

**User Story:** As a store owner, I want stock, sales, and discount records to reference only my own products, so that cross-owner references are impossible at the data layer.

#### Acceptance Criteria

1. IF a create or update of a `stock`, `sales`, or `discounts` record references a `product_id` that is not owned by the authenticated Owner, THEN THE Backend_Service SHALL reject the operation with a `4xx` status and SHALL write no row.
2. THE Backend_Service SHALL enforce same-owner references using a composite foreign key `(owner_id, product_id)` against a unique `products(id, owner_id)` constraint.
3. THE Backend_Service SHALL enforce same-owner references as an additional backstop via RLS policies on the referencing Data_Tables.

### Requirement 7: Products CRUD Vertical Slice

**User Story:** As a store owner, I want to create, read, update, and delete my products through the API, so that I can manage my product catalog, using a template that stock, sales, and discounts follow.

#### Acceptance Criteria

1. WHEN an authenticated Owner submits a valid product payload to the create endpoint, THE Product_Service SHALL persist the product scoped to that Owner and THE Backend_Service SHALL respond with status `201` and the created product.
2. WHEN an authenticated Owner reads a product they own by id after creating it, THE Product_Service SHALL return a record equal to the created product apart from server-set fields.
3. WHEN an authenticated Owner lists products, THE Product_Service SHALL return only products owned by that Owner.
4. WHEN an authenticated Owner updates or deletes a product they own, THE Product_Service SHALL apply the change to only that Owner's record.
5. IF an authenticated Owner requests, updates, or deletes a product id that is absent or not owned by that Owner, THEN THE Backend_Service SHALL respond with status `404`.
6. THE Backend_Service SHALL apply the same owner-scoped CRUD pattern used for products to the stock, sales, and discounts resources.

### Requirement 8: Request Validation, Status Codes, and Error Handling

**User Story:** As a frontend developer, I want consistent request validation and error responses, so that I can rely on predictable status codes without the backend leaking internal details.

#### Acceptance Criteria

1. WHEN a protected endpoint receives a request body or parameters, THE Backend_Service SHALL validate the input with a `zod` schema before invoking any service.
2. IF request validation fails, THEN THE Backend_Service SHALL respond with status `400` and SHALL include field-level detail about the failure.
3. WHEN the Error_Handler maps a known error type, THE Backend_Service SHALL respond with the corresponding HTTP status code: `401` for authentication errors, `400` for validation errors, `404` for not-found errors, and `403` for forbidden errors.
4. IF an unexpected error occurs, THEN THE Backend_Service SHALL respond with status `500` and SHALL log the full error detail server-side only, excluding internal details and secrets from the response body.

### Requirement 9: Health and Profile Endpoints

**User Story:** As an operator and as a store owner, I want an unauthenticated health check and a protected profile endpoint, so that I can monitor service liveness and retrieve my own profile.

#### Acceptance Criteria

1. WHEN a client calls the health endpoint without authentication, THE Backend_Service SHALL respond with a success status indicating liveness.
2. WHEN an authenticated Owner calls the `/me` endpoint, THE Backend_Service SHALL respond with that Owner's Profile.
3. IF a client calls the `/me` endpoint without a valid Bearer JWT, THEN THE Backend_Service SHALL respond with status `401`.

### Requirement 10: Testability Structure

**User Story:** As a backend developer, I want the application structured for testing, so that I can run unit, property-based, and integration tests without binding a real port and with injectable dependencies.

#### Acceptance Criteria

1. THE Backend_Service SHALL separate application construction (`app.ts`) from server start-up (`server.ts`) so that the application can be imported without binding a network port.
2. THE Backend_Service SHALL accept the configuration and the Supabase client as injected dependencies.
3. THE Backend_Service SHALL provide an integration anchor test that performs signup, obtains a JWT, creates a product with the Bearer token, and reads that product back.
4. THE Backend_Service SHALL provide a cross-owner isolation test that confirms a second Owner cannot retrieve the first Owner's product.
