// Run with node --experimental-vm-modules tests/rove_mods.mjs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { statSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

let live = [], shown = [], workspaces = [], calls = [];
let execute = async () => { throw new Error("must not run git while work is live"); };
function element() {
  const value = new Proxy({}, { get: (_, key) => key === "when"
    ? (condition, callback) => { if (condition) callback(value); return value; }
    : () => value });
  return value;
}
const api = {
  View: class {}, div: element, image: element, svg: path => {
    assert(statSync(new URL("../defaults/" + path, import.meta.url)).isFile(), path); return element();
  }, v_flex: element, h_flex: element, InputState: {}, Input: {}, Scrollbar: {},
  agents: () => [], spaces: () => workspaces, terminals: () => live, panes: () => shown,
  run: (...args) => calls.push(args), hc: async () => ({ code: 0, stdout: JSON.stringify({ terminals: live }) }),
  theme: () => ({}), props: () => ({ pane: "p1" }), closeOverlay() {}, openOverlay() {}, shared() {}, setShared() {}, home: () => "/home/test",
  exec: (...args) => execute(...args),
};
async function load(name) {
  const module = new vm.SourceTextModule(await readFile(new URL(`../defaults/mods/${name}/main.js`, import.meta.url), "utf8"));
  await module.link(() => new vm.SyntheticModule(Object.keys(api), function () {
    for (const [name, value] of Object.entries(api)) this.setExport(name, value);
  }));
  await module.evaluate();
  return new module.namespace.default();
}

const picker = await load("picker");
picker.filter = ""; picker.machines = []; picker.showEarlier = false;
live = [
  { address: "box/t1", name: "build", state: "live", labels: { "rove.detached": "1" } },
  { address: "t2", state: "finished", labels: { "rove.detached": "1" } },
  { address: "t3", state: "live", labels: {} },
  { address: "t4", state: "live", labels: { "rove.detached": "1" } },
];
shown = [{ terminal: "t4" }];
let detached = picker.rows().filter(r => r.kind === "detached");
assert.equal(detached.length, 1, "only detached live work without a pane appears even with no spaces");
assert.equal(detached[0].terminal.address, "box/t1");
picker.go(detached[0]);
assert.deepEqual(calls, [["terminal.keep", { terminal: "box/t1" }]]);
picker.filter = "missing";
assert.equal(picker.rows().filter(r => r.kind === "detached").length, 0);

const worktree = await load("worktree");
worktree.repo = { top: "/work/project" }; worktree.on = null;
live = [{ address: "t1", state: "live", cwd: "/work/project/child", labels: { "rove.detached": "1" } }];
assert.match(await worktree.remove(), /Stop the terminals/);
live = [{ address: "t1", state: "live", cwd: "/elsewhere", foreground: { cwd: "/work/project" } }];
assert.match(await worktree.remove(), /Stop the terminals/);
console.log("Rove mod regressions passed: detached discovery/reattach/filter and worktree ownership");

test("remote removal fails closed when aggregate listing omits its terminals", async () => {
  worktree.on = "box"; live = []; worktree.unpushed = [];
  let removed = false;
  execute = async (_command, args) => {
    if (args.includes("--get-regexp")) return { code: 1, stdout: "" };
    if (args.includes("--absolute-git-dir")) return { code: 0, stdout: "/work/main/.git/worktrees/project" };
    if (args.includes("remove")) removed = true;
    return { code: 0, stdout: "" };
  };
  assert.match(await worktree.remove(), /Remote worktree removal is unavailable/);
  assert.equal(removed, false);
});

test("both pane headers render with real bundled SVG assets", async () => {
  shown = [{ pane: "p1", terminal: "t1", cwd: "/home/test", title: "fixture" }];
  for (const name of ["pane", "terminals-pane"]) {
    const header = await load(name); header.hovered = true; header.render();
  }
});
