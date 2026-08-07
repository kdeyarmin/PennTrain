import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { human } from "./helpers";

export function Field({
  label,
  children,
  span = false,
}: {
  label: string;
  children: ReactNode;
  span?: boolean;
}) {
  // Visual label stays a plain <p>; clone aria-label onto Choice/Input children for a11y.
  const enriched = Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    const props = child.props as { "aria-label"?: string };
    return cloneElement(child as React.ReactElement<{ "aria-label"?: string }>, {
      "aria-label": props["aria-label"] ?? label,
    });
  });
  return (
    <div className={`space-y-1 ${span ? "sm:col-span-2" : ""}`}>
      <p className="text-sm font-medium leading-none">{label}</p>
      {enriched}
    </div>
  );
}
export function Choice({
  value,
  onChange,
  values,
  placeholder = "Select",
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  values: Array<string | { value: string; label: string }>;
  placeholder?: string;
  "aria-label"?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {values.map((item) => {
          const option =
            typeof item === "string"
              ? { value: item, label: human(item) }
              : item;
          return (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}
export function Status({ value }: { value: string }) {
  return (
    <Badge
      variant={
        value === "variance" || value === "delinquent"
          ? "destructive"
          : "secondary"
      }
    >
      {human(value)}
    </Badge>
  );
}

export function Summary({
  title,
  value,
  detail,
  alert = false,
}: {
  title: string;
  value: string;
  detail: string;
  alert?: boolean;
}) {
  return (
    <Card className={alert ? "border-destructive/50" : ""}>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle>{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">
        {detail}
      </CardContent>
    </Card>
  );
}
