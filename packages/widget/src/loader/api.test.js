import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createChatApi, install, WIDGET_ORIGIN_ATTR } from "./loader.js";

const ORIGIN = "https://chat.example";

function scriptTag(attrs = {}) {
  const script = document.createElement("script");
  script.src = `${ORIGIN}/embed/loader.js`;
  script.setAttribute("data-onyx", "https://onyx.example");
  script.setAttribute("data-persona", "12");
  for (const [k, v] of Object.entries(attrs)) script.setAttribute(k, v);
  document.body.appendChild(script);
  return script;
}

const frame = () => document.querySelector(`iframe[${WIDGET_ORIGIN_ATTR}]`);

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("createChatApi", () => {
  it("creates no iframe until something opens it", () => {
    // The host page owns the trigger, so nothing should be injected - and no
    // widget loaded - just because the script is on the page.
    createChatApi(scriptTag());
    expect(frame()).toBeNull();
  });

  it("creates the iframe on the first open", () => {
    const chat = createChatApi(scriptTag());
    chat.open();
    expect(frame()).not.toBeNull();
  });

  it("reuses the iframe on a second open rather than reloading the chat", () => {
    // Recreating it would drop the conversation, which is what a visitor would
    // notice most.
    const chat = createChatApi(scriptTag());
    chat.open();
    const first = frame();
    chat.open();
    expect(
      document.querySelectorAll(`iframe[${WIDGET_ORIGIN_ATTR}]`).length,
    ).toBe(1);
    expect(frame()).toBe(first);
  });

  it("opens straight to the panel, skipping the bubble", () => {
    // The host already has its own button; a second one inside the iframe would
    // be a bubble the visitor has to click twice.
    const chat = createChatApi(scriptTag());
    chat.open();
    expect(new URL(frame().src).searchParams.get("open")).toBe("1");
  });

  it("lets a trigger choose its own persona", () => {
    // Several buttons on one page, each opening a different assistant.
    const chat = createChatApi(scriptTag());
    chat.open({ persona: "2" });
    expect(new URL(frame().src).searchParams.get("persona")).toBe("2");
  });

  it("reloads when a different persona is requested", () => {
    // A different assistant is a different conversation, so reusing the frame
    // would leave the previous one answering.
    const chat = createChatApi(scriptTag());
    chat.open({ persona: "2" });
    chat.open({ persona: "13" });
    expect(new URL(frame().src).searchParams.get("persona")).toBe("13");
    expect(
      document.querySelectorAll(`iframe[${WIDGET_ORIGIN_ATTR}]`).length,
    ).toBe(1);
  });

  it("hides on close but keeps the conversation", () => {
    const chat = createChatApi(scriptTag());
    chat.open();
    chat.close();
    expect(frame()).not.toBeNull();
    expect(frame().style.display).toBe("none");
  });

  it("shows again on reopen", () => {
    const chat = createChatApi(scriptTag());
    chat.open();
    chat.close();
    chat.open();
    expect(frame().style.display).not.toBe("none");
  });

  it("toggles", () => {
    const chat = createChatApi(scriptTag());
    chat.toggle();
    expect(frame().style.display).not.toBe("none");
    chat.toggle();
    expect(frame().style.display).toBe("none");
  });

  it("reports whether it is open", () => {
    const chat = createChatApi(scriptTag());
    expect(chat.isOpen()).toBe(false);
    chat.open();
    expect(chat.isOpen()).toBe(true);
    chat.close();
    expect(chat.isOpen()).toBe(false);
  });

  it("closes when the widget asks to be closed", () => {
    // The panel has its own close control, and the host's state has to follow.
    const chat = createChatApi(scriptTag());
    chat.open();
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: ORIGIN,
        data: { type: "chat:close" },
      }),
    );
    expect(chat.isOpen()).toBe(false);
  });

  it("ignores messages from any other origin", () => {
    const chat = createChatApi(scriptTag());
    chat.open();
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://evil.example",
        data: { type: "chat:close" },
      }),
    );
    expect(chat.isOpen()).toBe(true);
  });

  it("is published on window so a page can call it from its own handler", () => {
    install(scriptTag());
    expect(typeof window.PretagovChat.open).toBe("function");
    expect(typeof window.PretagovChat.close).toBe("function");
    expect(typeof window.PretagovChat.toggle).toBe("function");
  });
});

describe("small screens", () => {
  const setViewport = (width, height) => {
    window.innerWidth = width;
    window.innerHeight = height;
  };

  afterEach(() => setViewport(1024, 768));

  it("never renders wider than the screen", () => {
    // At 400px fixed the panel hung 45px off the left edge of a 375px phone,
    // clipping the conversation.
    setViewport(375, 667);
    const chat = createChatApi(scriptTag());
    chat.open();
    expect(parseInt(frame().style.width, 10)).toBeLessThanOrEqual(375);
  });

  it("never renders taller than the screen", () => {
    setViewport(375, 667);
    const chat = createChatApi(scriptTag());
    chat.open();
    expect(parseInt(frame().style.height, 10)).toBeLessThanOrEqual(667);
  });

  it("goes edge to edge on a phone rather than floating a card", () => {
    // A 20px margin on every side wastes scarce width and looks like a mistake
    // at phone sizes; full-bleed is what a chat panel does there.
    setViewport(375, 667);
    const chat = createChatApi(scriptTag());
    chat.open();
    expect(frame().style.left).toBe("0px");
    expect(frame().style.right).toBe("0px");
  });

  it("keeps the floating card on a desktop viewport", () => {
    setViewport(1440, 900);
    const chat = createChatApi(scriptTag());
    chat.open();
    expect(frame().style.width).toBe("400px");
    expect(frame().style.right).toBe("20px");
  });

  it("shrinks to fit a short window instead of overflowing", () => {
    setViewport(1440, 500);
    const chat = createChatApi(scriptTag());
    chat.open();
    expect(parseInt(frame().style.height, 10)).toBeLessThanOrEqual(500);
  });

  it("re-fits when the window changes, as on rotation", () => {
    setViewport(1440, 900);
    const chat = createChatApi(scriptTag());
    chat.open();
    setViewport(375, 667);
    window.dispatchEvent(new Event("resize"));
    expect(parseInt(frame().style.width, 10)).toBeLessThanOrEqual(375);
  });
});

describe("per-trigger configuration", () => {
  it("passes a button's own arguments through to the widget", () => {
    // Several buttons on one page, each opening a differently configured chat -
    // not just a different persona.
    const chat = createChatApi(scriptTag());
    chat.open({ persona: "2", chatTitle: "Report a problem" });
    const params = new URL(frame().src).searchParams;
    expect(params.get("chatTitle")).toBe("Report a problem");
  });

  it("rebuilds when any argument differs, not only the persona", () => {
    // Keying the frame on the persona alone silently reuses the previous
    // widget when a button changes anything else about it.
    const chat = createChatApi(scriptTag());
    chat.open({ chatTitle: "Pay council tax" });
    chat.open({ chatTitle: "Report a problem" });
    const params = new URL(frame().src).searchParams;
    expect(params.get("chatTitle")).toBe("Report a problem");
    expect(
      document.querySelectorAll(`iframe[${WIDGET_ORIGIN_ATTR}]`).length,
    ).toBe(1);
  });

  it("reuses the frame when the same arguments come again", () => {
    const chat = createChatApi(scriptTag());
    chat.open({ chatTitle: "Pay council tax" });
    const first = frame();
    chat.open({ chatTitle: "Pay council tax" });
    expect(frame()).toBe(first);
  });

  it("carries a list argument as repeated parameters", () => {
    // Duplicate data- attributes are illegal HTML and the parser keeps only the
    // first, so a list can only reach the widget from the trigger.
    const chat = createChatApi(scriptTag());
    chat.open({ starterPrompts: ["Pay council tax", "Report a problem"] });
    const params = new URL(frame().src).searchParams;
    expect(params.getAll("starterPrompts")).toEqual([
      "Pay council tax",
      "Report a problem",
    ]);
  });
});

describe("a caller-supplied container", () => {
  it("mounts into the container rather than the body", () => {
    const slot = document.createElement("div");
    slot.id = "chat-slot";
    document.body.appendChild(slot);
    const chat = createChatApi(scriptTag());
    chat.open({ target: slot });
    expect(slot.querySelector("iframe")).toBe(frame());
  });

  it("leaves placement to the host stylesheet", () => {
    // A fixed, bottom-right iframe would ignore the slot it was put in.
    const slot = document.createElement("div");
    document.body.appendChild(slot);
    const chat = createChatApi(scriptTag());
    chat.open({ target: slot });
    expect(frame().style.position).toBe("");
    expect(frame().style.width).toBe("");
  });

  it("keeps the container out of the widget url", () => {
    const slot = document.createElement("div");
    document.body.appendChild(slot);
    const chat = createChatApi(scriptTag());
    chat.open({ target: slot });
    expect(new URL(frame().src).searchParams.has("target")).toBe(false);
  });

  it("still floats when no container is given", () => {
    const chat = createChatApi(scriptTag());
    chat.open();
    expect(frame().style.position).toBe("fixed");
  });

  it("moves to the container when a later trigger asks for one", () => {
    const slot = document.createElement("div");
    document.body.appendChild(slot);
    const chat = createChatApi(scriptTag());
    chat.open();
    chat.open({ target: slot });
    expect(slot.querySelector("iframe")).toBe(frame());
    expect(
      document.querySelectorAll(`iframe[${WIDGET_ORIGIN_ATTR}]`).length,
    ).toBe(1);
  });
});
