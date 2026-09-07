import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { documentHasUnsavedInput, isDeploymentAssetError, recoverFromStaleDeployment } from "./deploymentRecovery";

describe("deployment recovery", () => {
  it("recognizes stale dynamic import failures without matching normal errors", () => {
    expect(isDeploymentAssetError(new TypeError("Failed to fetch dynamically imported module"))).toBe(true);
    expect(isDeploymentAssetError(new Error("ChunkLoadError: Loading chunk 42 failed"))).toBe(true);
    expect(isDeploymentAssetError(new Error("Permission denied"))).toBe(false);
  });

  it("clears service-worker state and reloads only once", async () => {
    const state = new Map<string, string>();
    const unregister = vi.fn(async () => true);
    const deleteCache = vi.fn(async () => true);
    const reload = vi.fn();
    const environment = {
      sessionStorage: {
        getItem: (key: string) => state.get(key) ?? null,
        setItem: (key: string, value: string) => { state.set(key, value); },
      },
      serviceWorker: { getRegistrations: async () => [{ unregister }] },
      caches: { keys: async () => ["app-chunks"], delete: deleteCache },
      reload,
    };

    const error = new TypeError("Failed to fetch dynamically imported module");
    expect(await recoverFromStaleDeployment(error, environment)).toBe(true);
    expect(unregister).toHaveBeenCalledOnce();
    expect(deleteCache).toHaveBeenCalledWith("app-chunks");
    expect(reload).toHaveBeenCalledOnce();
    expect(await recoverFromStaleDeployment(error, environment)).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });
});

/**
 * The stale-shell notice, pinned at the two places CI found it wrong.
 *
 * Both defects shipped together in the P3 pass and CI caught them in the same run, six browser
 * journeys deep: the notice was announced on an ordinary first visit, and while it was up it
 * swallowed the click on the Sign in button underneath it. Neither is visible to a unit test that
 * only exercises the recovery path, so they are pinned here on the DOM the notice actually builds.
 */
/**
 * A document just large enough for showStaleShellNotice, which only ever calls createElement,
 * getElementById, append and body.appendChild. The suite runs on the node environment by design --
 * every other test here is pure logic -- so this stub is cheaper and more honest than pulling in
 * jsdom for one function whose entire output is a handful of inline styles.
 */
function stubDocument() {
  const created: StubElement[] = [];
  interface StubElement {
    id: string;
    tagName: string;
    type?: string;
    textContent?: string;
    style: { cssText: string } & Record<string, string>;
    children: StubElement[];
    attributes: Record<string, string>;
    setAttribute(name: string, value: string): void;
    addEventListener(): void;
    append(...nodes: StubElement[]): void;
    appendChild(node: StubElement): StubElement;
    remove(): void;
  }
  const makeStyle = () => {
    const style = { cssText: "" } as { cssText: string } & Record<string, string>;
    return new Proxy(style, {
      set(target, key, value) {
        if (key === "cssText") {
          target.cssText = String(value);
          // Mirror the shorthand into individual properties, which is what a real CSSStyleDeclaration
          // does and what the assertions below read.
          for (const rule of String(value).split(";")) {
            const [name, ...rest] = rule.split(":");
            if (!name || rest.length === 0) continue;
            const camel = name.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            target[camel] = rest.join(":").trim();
          }
          return true;
        }
        target[key as string] = String(value);
        return true;
      },
    });
  };
  const element = (tagName: string): StubElement => {
    const node: StubElement = {
      id: "",
      tagName: tagName.toUpperCase(),
      style: makeStyle(),
      children: [],
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener() {},
      append(...nodes) { this.children.push(...nodes); },
      appendChild(child) { this.children.push(child); return child; },
      remove() {},
    };
    created.push(node);
    return node;
  };
  const body = element("body");
  return {
    createElement: (tag: string) => element(tag),
    getElementById: (id: string) => created.find((node) => node.id === id) ?? null,
    body,
    all: created,
  };
}

describe("the stale-shell notice", () => {
  it("is transparent to the pointer except on its own controls", async () => {
    const { showStaleShellNotice } = await import("./deploymentRecovery");
    const doc = stubDocument();
    showStaleShellNotice(doc as unknown as Document);

    const bar = doc.getElementById("carebase-stale-deployment-notice");
    expect(bar, "the notice was not rendered").not.toBeNull();
    // A fixed element at z-index 2147483647 that takes pointer events blocks every click inside its
    // rectangle. On a phone-width viewport that rectangle covers the login form, which is exactly
    // where CI found it.
    expect(bar!.style.pointerEvents).toBe("none");

    const buttons = bar!.children.filter((node) => node.tagName === "BUTTON");
    expect(buttons.length, "the notice should offer reload and dismiss").toBe(2);
    for (const button of buttons) {
      expect(button.style.pointerEvents).toBe("auto");
    }
  });

  it("renders once even if announced twice", async () => {
    const { showStaleShellNotice } = await import("./deploymentRecovery");
    const doc = stubDocument();
    showStaleShellNotice(doc as unknown as Document);
    showStaleShellNotice(doc as unknown as Document);
    expect(doc.body.children.filter((n) => n.id === "carebase-stale-deployment-notice").length).toBe(1);
  });

  it("does not announce a new release when a worker claims a tab that had none", () => {
    // `controllerchange` fires on a first visit too, when a newly installed worker claims a tab
    // that was not controlled. That is not a release replacing running code, and telling a new
    // visitor their brand-new page is out of date is worse than saying nothing.
    const source = readFileSync(join(__dirname, "deploymentRecovery.ts"), "utf8");
    expect(source).toContain("const hadControllerAtInstall = Boolean(navigator.serviceWorker?.controller)");
    expect(source).toContain("if (!hadControllerAtInstall) return;");
  });
});

describe("a cleared prefilled field is still unsaved input", () => {
  // The suite runs without a DOM, and this predicate takes its Document as a parameter for exactly
  // that reason -- the same injection `recoverFromStaleDeployment` uses for its environment. Only
  // the four properties the function reads are stubbed; anything more would be testing jsdom.
  type Field = {
    disabled?: boolean; readOnly?: boolean; type?: string;
    value: string; defaultValue: string;
  };
  const docWith = (fields: Field[]) => ({
    querySelectorAll: (selector: string) => (selector === "input, textarea" ? fields : []),
  } as unknown as Document);

  // Requiring a non-empty value meant emptying a field the server had prefilled read as "nothing
  // to lose", so the automatic reload after a stale chunk discarded it. Deleting a wrong value is
  // an edit, and often a more deliberate one than typing over it.
  it("reports a prefilled field the user has emptied", () => {
    expect(documentHasUnsavedInput(docWith([{ value: "", defaultValue: "Prefilled reason" }]))).toBe(true);
  });

  it("still reports an ordinary edit", () => {
    expect(documentHasUnsavedInput(docWith([{ value: "Changed", defaultValue: "Prefilled" }]))).toBe(true);
  });

  it("stays silent on an untouched empty field, which equals its own default", () => {
    expect(documentHasUnsavedInput(docWith([{ value: "", defaultValue: "" }]))).toBe(false);
  });

  it("stays silent on an untouched prefilled field", () => {
    expect(documentHasUnsavedInput(docWith([{ value: "Prefilled", defaultValue: "Prefilled" }]))).toBe(false);
  });

  // A disabled or read-only field cannot hold an unsaved edit, and skipping them is what keeps this
  // from reporting a false positive that leaves a genuinely broken shell un-reloaded.
  it("ignores fields the user cannot have edited", () => {
    expect(documentHasUnsavedInput(docWith([
      { value: "", defaultValue: "Prefilled", disabled: true },
      { value: "", defaultValue: "Prefilled", readOnly: true },
    ]))).toBe(false);
  });
});
