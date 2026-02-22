import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";

const PreferenceSchema = z.object({
    timeDisplayPref: z.enum(["EVENT_LOCAL", "USER_LOCAL"]),
});

export async function PATCH(request: Request) {
    try {
        const user = await getOrCreateUser();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const json = await request.json();
        const body = PreferenceSchema.safeParse(json);

        if (!body.success) {
            return NextResponse.json(
                { error: "Invalid preference data", details: body.error.flatten() },
                { status: 400 }
            );
        }

        const updatedUser = await prisma.user.update({
            where: { id: user.id },
            data: {
                timeDisplayPref: body.data.timeDisplayPref,
            },
            select: {
                id: true,
                timeDisplayPref: true,
            }
        });

        return NextResponse.json({ success: true, user: updatedUser });
    } catch (error) {
        console.error("Error updating user preferences:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
