import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from "@yamp/ui";

export function WeekPlan() {
  return (
    <Table>
      <TableCaption>This week's dinners · Sep 2 – Sep 6</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Recipe</TableHead>
          <TableHead>Protein</TableHead>
          <TableHead>Cuisine</TableHead>
          <TableHead style={{ textAlign: "right" }}>Time</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Pan-seared salmon</TableCell>
          <TableCell>Salmon</TableCell>
          <TableCell>Mediterranean</TableCell>
          <TableCell style={{ textAlign: "right" }}>25 min</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Chicken tikka masala</TableCell>
          <TableCell>Chicken</TableCell>
          <TableCell>Indian</TableCell>
          <TableCell style={{ textAlign: "right" }}>40 min</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Beef and broccoli stir-fry</TableCell>
          <TableCell>Beef</TableCell>
          <TableCell>Asian</TableCell>
          <TableCell style={{ textAlign: "right" }}>30 min</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Crispy tofu rice bowl</TableCell>
          <TableCell>Tofu</TableCell>
          <TableCell>Korean</TableCell>
          <TableCell style={{ textAlign: "right" }}>35 min</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>White bean and kale soup</TableCell>
          <TableCell>Beans</TableCell>
          <TableCell>Italian</TableCell>
          <TableCell style={{ textAlign: "right" }}>45 min</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
