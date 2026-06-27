## ADDED Requirements

### Requirement: The tool console seeds arguments with a schema-derived example and tolerates comments

When a tool is selected, the console SHALL pre-fill its argument input with an editable example **generated structurally from the tool's input JSON Schema** — not from any hand-maintained per-tool text — so that a newly registered tool gets a useful example with no console-specific code. In the example, every **required** field SHALL be present with a type-appropriate placeholder value, and every **optional** field SHALL be present but **commented out**; the example SHALL be pretty-printed (indented, one field per line). An `enum` field SHALL use its first allowed value and list the alternatives in a comment; a field with a schema `default` SHALL use that default; a nullable field SHALL be shown as its underlying type's example; a no-field tool SHALL yield `{}`.

Because the example uses comments, the argument input SHALL accept JSON containing `//` line comments, `/* */` block comments, and trailing commas: the console SHALL strip these before submitting, **preserving** any such sequence that occurs inside a string value. Stripping SHALL be a client-side input convenience only — it SHALL NOT bypass or alter the server-side input validation, which remains the sole validator of the submitted arguments.

The generated example SHALL be valid after stripping: submitting it unmodified SHALL parse to the schema's required-only object (every optional field omitted because commented out).

#### Scenario: Selecting a tool seeds a schema-derived example

- **WHEN** the operator selects a tool whose catalog entry is loaded
- **THEN** the argument input is pre-filled with a pretty-printed JSON example derived from that tool's input schema, with required fields present and optional fields commented out, rather than a bare `{}`

#### Scenario: Enum and optional fields are rendered for discoverability

- **WHEN** the seeded example includes an `enum` field and one or more optional fields
- **THEN** the enum field shows a first allowed value with the alternatives listed in a comment, and each optional field appears commented out so the operator can uncomment the ones to send

#### Scenario: The seeded example submits unmodified

- **WHEN** the operator runs a tool without editing the seeded example
- **THEN** the console strips the comments and submits the underlying JSON, which is the schema's required-only object (optional fields omitted)

#### Scenario: Comments and trailing commas are tolerated on submit

- **WHEN** the operator submits arguments containing `//` or `/* */` comments or trailing commas
- **THEN** the console strips them and submits the underlying JSON, while leaving intact any `//` or `/*` that appears inside a string value

#### Scenario: A tool with no input fields stays empty

- **WHEN** the operator selects a tool whose input schema declares no fields
- **THEN** the seeded example is `{}`

#### Scenario: Editing replaces the seeded example until the tool changes

- **WHEN** the operator edits the argument input and then selects a different tool
- **THEN** their edited text is preserved while that tool stays selected, and selecting another tool reseeds the input from the newly selected tool's schema
