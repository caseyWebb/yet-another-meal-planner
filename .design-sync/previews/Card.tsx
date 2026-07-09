import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
  Button,
  Badge,
  IconHeart,
} from "@yamp/ui";

export function RecipeCard() {
  return (
    <Card style={{ maxWidth: 360 }}>
      <CardHeader>
        <CardTitle>Pan-seared salmon</CardTitle>
        <CardDescription>Quick weeknight main · 25 min</CardDescription>
        <CardAction>
          <Button size="icon" variant="ghost" aria-label="Favorite">
            <IconHeart />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        Crisp-skinned salmon with roasted broccoli and lemon rice — high-protein and on the table in under half an hour.
      </CardContent>
      <CardFooter style={{ gap: 8 }}>
        <Button>Cook tonight</Button>
        <Button variant="outline">Add to plan</Button>
      </CardFooter>
    </Card>
  );
}

export function WithBadges() {
  return (
    <Card style={{ maxWidth: 360 }}>
      <CardHeader>
        <CardTitle>Chicken tikka masala</CardTitle>
        <CardDescription>Comfort dinner · serves 4</CardDescription>
      </CardHeader>
      <CardContent style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Badge>Indian</Badge>
        <Badge variant="secondary">Chicken</Badge>
        <Badge variant="outline">40 min</Badge>
      </CardContent>
    </Card>
  );
}
