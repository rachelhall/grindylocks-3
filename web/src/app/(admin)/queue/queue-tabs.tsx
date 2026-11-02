"use client";

import { Tabs } from "@base-ui/react/tabs";

import { cn } from "@/lib/utils";

const tabs = [
  {
    value: "all",
    label: "All",
    empty: "Nothing waiting. Reports, park info reports and suggested obstacles show up here.",
  },
  {
    value: "reports",
    label: "Reports",
    empty: "No reports waiting. Reported posts, comments and people show up here.",
  },
  {
    value: "park-info",
    label: "Park info",
    empty: "No park info reports waiting. Fixes members suggest for a park's details show up here.",
  },
  {
    value: "obstacles",
    label: "Suggested obstacles",
    empty: "No suggested obstacles waiting. Obstacles members add while posting show up here.",
  },
] as const;

/**
 * The queue's type tabs (Base UI Tabs). Each panel is empty until the queue
 * data arrives; empty states are plain sentences, no illustrations.
 */
export function QueueTabs() {
  return (
    <Tabs.Root defaultValue="all" className="flex flex-1 flex-col">
      <Tabs.List
        aria-label="Queue type"
        className="flex gap-6 overflow-x-auto border-b-2 border-gl-border px-6 pt-4"
      >
        {tabs.map((tab) => (
          <Tabs.Tab
            key={tab.value}
            value={tab.value}
            className={cn(
              "-mx-1 -mb-0.5 h-control shrink-0 px-1 border-b-[3px] border-transparent whitespace-nowrap type-body-sm font-medium text-gl-text-secondary",
              "hover:text-gl-text focus-ring focus-visible:outline-offset-[-2px]",
              "data-active:border-gl-text data-active:font-bold data-active:text-gl-text",
            )}
          >
            {tab.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {tabs.map((tab) => (
        <Tabs.Panel key={tab.value} value={tab.value} className="px-6 py-6 focus-ring">
          <p className="max-w-[60ch] type-body">{tab.empty}</p>
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  );
}
