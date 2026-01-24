import {
  selectedSidebarChatbot,
  sourcesForSelectedMessage,
  newChatTrigger,
} from "#stores/sidebarStore";
import ChatWindow from "@eeacms/volto-chatbot/ChatBlock/ChatWindow";
import { useStore } from "@nanostores/react";
import Icon from "@plone/volto/components/theme/Icon/Icon";
import { Button } from "semantic-ui-react";
import { SVGIcon } from "../../ChatBlock/utils";
import PenIcon from "../../icons/square-pen.svg";

// ChatBlock
import { getBlocksFieldname } from "@plone/volto/helpers";
import { injectLazyLibs } from "@plone/volto/helpers/Loadable/Loadable";
import { forwardRef } from "react";
import superagent from "superagent";
import withDanswerData from "../../ChatBlock/withDanswerData";
import { getSourceDisplayName } from "../../ChatBlock/utils";

import clearSVG from "@plone/volto/icons/clear.svg";

import config from "@plone/registry";

import loadable from "@loadable/component";
const Markdown = loadable(() => import("react-markdown"));

// const ChatBlockDisplay = withDanswerData(({ assistant }) => [
//   "assistantData",
//   typeof assistant !== "undefined" && assistant !== null
//     ? superagent.get(`/_da/persona/${assistant}`).type("json")
//     : () => {},
//   assistant,
// ])(function ChatBlockDisplay({ data, assistantData }) {
//   if (!assistantData) {
//     return null;
//   }
//   return <ChatWindow persona={assistantData} {...data} />;
// });
function ChatBlockDisplay({ data, assistantData }) {
  // if (!assistantData) {
  //   return null;
  // }
  return <ChatWindow persona={assistantData} {...data} />;
}

const SideContent = injectLazyLibs(["luxon"])(function SideContent({
  sources,
  luxon,
}) {
  return (
    <>
      <div className="heading">
        <Button
          type="button"
          basic
          aria-label={"Close sources"}
          onClick={() => {
            sourcesForSelectedMessage.set([]);
          }}
        >
          <Icon circled name={clearSVG} size="48px" />
        </Button>
        <h2 id="dialog_heading">Sources</h2>
      </div>
      {sources?.length > 0 ? (
        <ul role="list" className="all-sources-display">
          {sources.map((source, index) => {
            return (
              <li key={index} className="">
                <div className="all-sources-display__header">
                  <div className="chat-citation">{index + 1}</div>
                  <a href={source.link}>
                    <h3>{getSourceDisplayName(source)}</h3>
                  </a>
                </div>
                <time dateTime={source.updated_at}>
                  {luxon.DateTime.fromISO(source.updated_at)?.toRelative()}
                </time>
                <div className="all-sources-display__description">
                  {source.match_highlights?.filter(Boolean).length > 0 ? (
                    source.match_highlights.filter(Boolean).map((text, i) => (
                      <p key={i} dangerouslySetInnerHTML={{ __html: text }} />
                    ))
                  ) : (
                    <Markdown
                      components={{
                        p: (props) => {
                          const { node, ...rest } = props;
                          const value = node.children?.[0]?.value || "";
                          return value;
                        },
                        a: (props) => {
                          const { node, href } = props;
                          const value = node.children?.[0]?.value || href || "";
                          return <a href={href} target="_blank" rel="noreferrer">{value}</a>;
                        },
                        h1: (props) => {
                          const { node, ...rest } = props;
                          const value = node.children?.[0]?.value || "";
                          return `${value}. `;
                        },
                        h2: (props) => {
                          const { node, ...rest } = props;
                          const value = node.children?.[0]?.value || "";
                          return `${value}. `;
                        },
                        h3: (props) => {
                          const { node, ...rest } = props;
                          const value = node.children?.[0]?.value || "";
                          return `${value}. `;
                        },
                        ul: (props) => {
                          const { node, ...rest } = props;
                          const liNodes = node.children.filter(
                            (child) => child.tagName === "li",
                          );
                          // Assumed the list element is either text or an element with text.
                          const listValues = liNodes.map((node) => {
                            const childNode = node.children?.[0];
                            if (childNode.value) {
                              return childNode.value;
                            }
                            return childNode.children[0].value;
                          });
                          return listValues.join(". ");
                        },
                      }}
                    >
                      {source.blurb}
                    </Markdown>
                  )}
                </div>
                {/* <p dangerouslySetInnerHTML={{ __html: source.blurb }}></p> */}
              </li>
            );
          })}
        </ul>
      ) : (
        <p>No sources</p>
      )}
    </>
  );
});

export const SidebarDisplay = forwardRef(function SidebarDisplay(
  { content },
  ref,
) {
  const $selectedSidebarChatbot = useStore(selectedSidebarChatbot);

  const $sourcesForSelectedMessage = useStore(sourcesForSelectedMessage);
  const isSidebarVisible = $sourcesForSelectedMessage?.length > 0;

  const blocksFieldname = getBlocksFieldname(content) || "blocks";
  const sidebarBlockData =
    content?.[blocksFieldname]?.[
      Object.keys(content?.[blocksFieldname] || {}).find(
        (blockId) => blockId === $selectedSidebarChatbot,
      )
    ];

  const sidebarTitle =
    sidebarBlockData?.starterPromptsHeading ||
    config.settings["volto-chatbot"]?.sidebar?.sidebarTitle ||
    "Help using this site";

  return (
    <>
      <div id="chatbot-sidebar">
        <dialog
          aria-modal="true"
          id="chatbot-sidebar-dialog"
          aria-labelledby="dialog_heading"
          ref={ref}
          data-sidebar-open={isSidebarVisible}
          closedby="any"
        >
          <div className="dialog-main">
            <div className="heading">
              {isSidebarVisible ? null : (
                <Button
                  type="button"
                  basic
                  aria-label={"Close"}
                  onClick={() => {
                    selectedSidebarChatbot.set(null);
                    sourcesForSelectedMessage.set([]);
                  }}
                >
                  <Icon circled name={clearSVG} size="48px" />
                </Button>
              )}
              <Button
                type="button"
                className="new-chat-btn"
                aria-label="New chat"
                title="New chat"
                onClick={() => {
                  newChatTrigger.set(newChatTrigger.get() + 1);
                }}
              >
                <SVGIcon name={PenIcon} size="18" />
              </Button>
              <h2 id="dialog_heading">{sidebarTitle}</h2>
            </div>
            <ChatBlockDisplay
              assistant={sidebarBlockData?.assistant}
              data={sidebarBlockData}
            />
          </div>
          <div className="dialog-side">
            <div className="dialog-main">
              <div className="dialog-side__wrapper">
                <SideContent sources={$sourcesForSelectedMessage} />
              </div>
            </div>
          </div>
        </dialog>
      </div>
    </>
  );
});
