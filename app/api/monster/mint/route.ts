import { NextResponse } from "next/server";
import { publicClient, GENESIS_EGG_ADDRESS } from "@/lib/contracts/viemClient";
import { createServiceClient } from "@/lib/supabase/server";
import { rollRandomSpecies } from "@/lib/constants/monsterBaseStats";

export async function POST(req: Request) {
  try {
    const { walletAddress, txHash } = await req.json();

    if (!walletAddress || !txHash) {
      return NextResponse.json(
        { error: "walletAddress and txHash are required to awaken a Crystal." },
        { status: 400 }
      );
    }

    // 1. Verifikasi transaksi onchain
    const receipt = await publicClient.getTransactionReceipt({
      hash: txHash,
    });

    if (receipt.status !== "success") {
      return NextResponse.json(
        { error: "The on-chain transaction is invalid or has not yet been confirmed." },
        { status: 400 }
      );
    }

    // Cek apakah transaksi ini ke contract GenesisEgg yang benar
    if (receipt.to?.toLowerCase() !== GENESIS_EGG_ADDRESS.toLowerCase()) {
      return NextResponse.json(
        { error: "This transaction was not sent to the Genesis Crystal contract." },
        { status: 400 }
      );
    }

    // 2. Ekstrak tokenId dari event log Minted
    let tokenId: string | null = null;
    for (const log of receipt.logs) {
      // Event: Minted(address indexed to, uint256 indexed tokenId)
      if (log.topics.length === 3) {
        const toAddress = `0x${log.topics[1]?.slice(-40)}`.toLowerCase();
        if (toAddress === walletAddress.toLowerCase()) {
          tokenId = BigInt(log.topics[2] ?? "0x0").toString();
          break;
        }
      }
    }

    if (!tokenId) {
      return NextResponse.json(
        { error: "Crystal Token ID not found in the transaction log." },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // 3. Cari atau buat user berdasarkan wallet_address
    let { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .ilike("wallet_address", walletAddress)
      .maybeSingle();

    if (userError) {
      throw new Error(`Failed to locate summoner: ${userError.message}`);
    }

    let userId = user?.id;

    if (!userId) {
      return NextResponse.json(
        { error: "Wallet not yet bound to the Codex. Please login and link your X/Twitter account first." },
        { status: 401 }
      );
    }

    // Cek apakah user sudah punya monster (guard di database)
    const { data: existingMonster } = await supabase
      .from("monsters")
      .select("id")
      .eq("owner_id", userId)
      .maybeSingle();

    if (existingMonster) {
      return NextResponse.json(
        { error: "A Siggy has already emerged from this Vault. Each Summoner may only awaken one Genesis Crystal." },
        { status: 400 }
      );
    }

    // 4. Roll random species
    const species = rollRandomSpecies();

    // 5. Insert ke tabel monsters
    const { data: monster, error: monsterError } = await supabase
      .from("monsters")
      .insert({
        owner_id: userId,
        species_key: species.key,
        token_id: parseInt(tokenId, 10),
        mint_tx_hash: txHash,
        level: 1,
        evolution_stage: "initiate",
      })
      .select("id")
      .single();

    if (monsterError) {
      throw new Error(`Failed to inscribe the Siggy into the Codex: ${monsterError.message}`);
    }

    const monsterId = monster.id;

    // 6. Insert ke tabel monster_stats
    const { error: statsError } = await supabase.from("monster_stats").insert({
      monster_id: monsterId,
      hp: species.baseStats.hp,
      atk: species.baseStats.atk,
      def: species.baseStats.def,
      spd: species.baseStats.spd,
      crit: species.baseStats.crit,
      dodge: species.baseStats.dodge,
    });

    if (statsError) {
      throw new Error(`Failed to forge the Siggy's base stats: ${statsError.message}`);
    }

    // 7. Insert ke tabel monster_food_bonus (semua 0)
    const { error: bonusError } = await supabase
      .from("monster_food_bonus")
      .insert({
        monster_id: monsterId,
        hp_bonus: 0,
        atk_bonus: 0,
        def_bonus: 0,
        spd_bonus: 0,
        crit_bonus: 0,
        dodge_bonus: 0,
      });

    if (bonusError) {
      throw new Error(
        `Failed to bind the Siggy's offering records: ${bonusError.message}`
      );
    }

    return NextResponse.json({
      success: true,
      message: "A Siggy has successfully emerged from the Genesis Crystal!",
      monsterId,
      species: species.name,
      tokenId,
    });
  } catch (error: any) {
    console.error("Mint API Error:", error);
    return NextResponse.json(
      { error: error.message || "An internal disturbance prevented the Crystal Awakening." },
      { status: 500 }
    );
  }
}
