"use client";

import { cn } from "@clawrun/ui/lib/utils";
import { Badge } from "@clawrun/ui/components/ui/badge";
import { ScrollArea } from "@clawrun/ui/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@clawrun/ui/components/ui/table";

// ---------------------------------------------------------------------------
// JSON Schema helpers
// ---------------------------------------------------------------------------

type SchemaObj = Record<string, unknown>;

function getProperties(schema: SchemaObj): Record<string, SchemaObj> {
  if (schema.properties && typeof schema.properties === "object") {
    return schema.properties as Record<string, SchemaObj>;
  }
  return {};
}

function getRequired(schema: SchemaObj): string[] {
  if (Array.isArray(schema.required)) return schema.required as string[];
  return [];
}

/** Human-readable type label from a JSON Schema property. */
function schemaTypeLabel(prop: SchemaObj): string {
  if (Array.isArray(prop.enum)) {
    const vals = (prop.enum as unknown[]).filter((v) => v !== null);
    if (vals.length <= 4) return vals.map((v) => String(v)).join(" | ");
    return `enum(${vals.length})`;
  }
  const union = (prop.oneOf ?? prop.anyOf) as SchemaObj[] | undefined;
  if (Array.isArray(union)) {
    return union
      .map((s) => schemaTypeLabel(s))
      .filter(Boolean)
      .join(" | ");
  }
  if (prop.type === "array") {
    const items = prop.items as SchemaObj | undefined;
    if (items) return `${schemaTypeLabel(items)}[]`;
    return "array";
  }
  if (Array.isArray(prop.type)) {
    return (prop.type as string[]).filter((t) => t !== "null").join(" | ");
  }
  if (typeof prop.type === "string") return prop.type;
  if (prop.properties) return "object";
  return "";
}

// ---------------------------------------------------------------------------
// Parameter row (recursive for nested objects)
// ---------------------------------------------------------------------------

function ParameterRow({
  name,
  prop,
  required,
  depth = 0,
}: {
  name: string;
  prop: SchemaObj;
  required: boolean;
  depth?: number;
}) {
  const typeLabel = schemaTypeLabel(prop);
  const nested = getProperties(prop);
  const nestedRequired = getRequired(prop);
  const nestedEntries = Object.entries(nested);

  return (
    <>
      <TableRow>
        <TableCell className="align-top">
          <div style={{ paddingLeft: depth * 16 }}>
            <code className="text-xs font-semibold">{name}</code>
          </div>
        </TableCell>
        <TableCell className="align-top">
          <code className="text-xs text-muted-foreground">{typeLabel || "—"}</code>
        </TableCell>
        <TableCell className="align-top text-center">
          {required ? (
            <Badge variant="destructive" className="h-4 px-1 text-[10px]">
              yes
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">no</span>
          )}
        </TableCell>
        <TableCell className="align-top">
          {prop.default !== undefined && (
            <code className="text-xs text-muted-foreground">
              {JSON.stringify(prop.default)}
            </code>
          )}
        </TableCell>
        <TableCell className="align-top">
          {typeof prop.description === "string" ? (
            <span className="text-xs text-muted-foreground">{prop.description}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </TableCell>
      </TableRow>
      {nestedEntries.map(([k, v]) => (
        <ParameterRow
          key={`${name}.${k}`}
          name={k}
          prop={v}
          required={nestedRequired.includes(k)}
          depth={depth + 1}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

interface JsonSchemaTableProps {
  /** The JSON Schema object (typically a tool's `parameters`). */
  schema: Record<string, unknown>;
  /** Additional class name for the scrollable container. */
  className?: string;
}

/**
 * Renders a JSON Schema `properties` object as a table with
 * Name, Type, Required, Default, and Description columns.
 * Handles nested object properties recursively.
 *
 * The component itself is a scrollable container (`overflow-y-auto`).
 * Constrain its height via className (e.g. `className="max-h-[50vh]"`)
 * or let the parent layout handle it with `min-h-0 flex-1`.
 */
export function JsonSchemaTable({ schema, className }: JsonSchemaTableProps) {
  const properties = getProperties(schema as SchemaObj);
  const required = getRequired(schema as SchemaObj);
  const entries = Object.entries(properties);

  if (entries.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">No parameters</p>
    );
  }

  return (
    <ScrollArea className={cn("rounded-lg border", className)}>
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead className="w-[140px]">Name</TableHead>
            <TableHead className="w-[100px]">Type</TableHead>
            <TableHead className="w-[70px] text-center">Required</TableHead>
            <TableHead className="w-[80px]">Default</TableHead>
            <TableHead>Description</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map(([name, prop]) => (
            <ParameterRow
              key={name}
              name={name}
              prop={prop}
              required={required.includes(name)}
            />
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}
