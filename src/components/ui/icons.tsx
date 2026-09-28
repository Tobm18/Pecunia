import {
  ArrowLeftRight,
  Baby,
  Book,
  BriefcaseBusiness,
  Bus,
  Circle,
  CircleEllipsis,
  CreditCard,
  Fuel,
  Gift,
  HeartPulse,
  House,
  Landmark,
  PawPrint,
  PiggyBank,
  Plane,
  Repeat,
  Shirt,
  ShoppingCart,
  SlidersHorizontal,
  Smartphone,
  Ticket,
  Utensils,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { clsx } from "clsx";

/** Icônes nommées stockées en base (categories.icon, accounts.icon). */
const ICONS: Record<string, LucideIcon> = {
  cart: ShoppingCart,
  utensils: Utensils,
  bus: Bus,
  home: House,
  repeat: Repeat,
  ticket: Ticket,
  heart: HeartPulse,
  piggy: PiggyBank,
  more: CircleEllipsis,
  briefcase: BriefcaseBusiness,
  card: CreditCard,
  bank: Landmark,
  plane: Plane,
  wallet: Wallet,
  gift: Gift,
  shirt: Shirt,
  book: Book,
  baby: Baby,
  paw: PawPrint,
  fuel: Fuel,
  phone: Smartphone,
  transfer: ArrowLeftRight,
  adjust: SlidersHorizontal,
  circle: Circle,
};

export function iconFor(name: string): LucideIcon {
  return ICONS[name] ?? Circle;
}

/** Pastille carrée colorée avec icône (lignes de transactions, comptes, catégories). */
export function IconBadge({
  icon,
  color,
  size = "md",
  className,
}: {
  icon: string;
  color: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const Icon = iconFor(icon);
  const box = size === "sm" ? "size-7 rounded-lg" : size === "lg" ? "size-11 rounded-xl" : "size-9 rounded-[10px]";
  const glyph = size === "sm" ? 14 : size === "lg" ? 20 : 17;
  return (
    <span
      className={clsx("inline-flex shrink-0 items-center justify-center text-white", box, className)}
      style={{ backgroundColor: color }}
      aria-hidden
    >
      <Icon size={glyph} strokeWidth={2} />
    </span>
  );
}
