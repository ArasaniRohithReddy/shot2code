import { IconType } from "react-icons";
import {
  SiAlpinedotjs,
  SiBootstrap,
  SiBulma,
  SiCss3,
  SiDaisyui,
  SiHtml5,
  SiIonic,
  SiMaterialdesign,
  SiPreact,
  SiReact,
  SiTailwindcss,
  SiVuedotjs,
} from "react-icons/si";
import { LuCode2 } from "react-icons/lu";

export const STACK_COMPONENT_LOGOS: {
  [name: string]: { icon: IconType; color: string };
} = {
  HTML: { icon: SiHtml5, color: "#E34F26" },
  CSS: { icon: SiCss3, color: "#1572B6" },
  Tailwind: { icon: SiTailwindcss, color: "#06B6D4" },
  React: { icon: SiReact, color: "#61DAFB" },
  Bootstrap: { icon: SiBootstrap, color: "#7952B3" },
  Vue: { icon: SiVuedotjs, color: "#4FC08D" },
  Ionic: { icon: SiIonic, color: "#3880FF" },
  "Alpine.js": { icon: SiAlpinedotjs, color: "#8BC0D0" },
  Preact: { icon: SiPreact, color: "#673AB8" },
  daisyUI: { icon: SiDaisyui, color: "#1AD1A5" },
  Bulma: { icon: SiBulma, color: "#00D1B2" },
  "Material 3": { icon: SiMaterialdesign, color: "#6750A4" },
  htmx: { icon: LuCode2, color: "#3366CC" },
};
