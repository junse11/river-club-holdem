package com.holdem.game;

import java.util.*;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class BountyTest {
    PokerTable prepared(long... stacks){
        var t=new PokerTable("BOUNTY01","Bounty","p0");
        for(int i=0;i<stacks.length;i++){t.join("p"+i,"Player "+i,stacks[i]);t.member("p"+i).ready=true;}
        t.start("p0");t.board.clear();t.board.addAll(List.of("2C","5D","8H","10S","11C"));
        return t;
    }
    void allIn(PokerTable t,String[][] holes,long... contributed){
        for(int i=0;i<contributed.length;i++){var p=t.players.get(i);p.cards.clear();p.cards.addAll(List.of(holes[i]));p.stack+=p.committed-contributed[i];p.committed=contributed[i];p.bet=contributed[i];}
        t.invariant();t.settle();
    }
    @Test void knockoutAwardsOnceAndResetsEveryoneBeforeNextDeal(){
        var t=prepared(10000,10000);
        allIn(t,new String[][]{{"14S","14D"},{"13S","13D"}},10000,10000);
        assertThat(t.member("p0").bountyUnits).isEqualTo(60);assertThat(t.member("p1").stack).isZero();assertThat(t.resetPending).isTrue();
        assertThat(t.history.getFirst().get("resetToBb")).isEqualTo(100);
        t.settle();assertThat(t.member("p0").bountyUnits).isEqualTo(60);assertThat(t.history).hasSize(1);
        t.tick(t.nextHandAt+1);
        assertThat(t.street).isEqualTo("PREFLOP");assertThat(t.hand).isEqualTo(2);assertThat(t.resetPending).isFalse();
        for(var p:t.players)assertThat(p.stack+p.committed).isEqualTo(100*t.bb);
        assertThat(t.member("p0").bountyUnits).isEqualTo(60);t.invariant();
    }
    @Test void eachVictimAwardsItsLastContestedPotWinner(){
        var t=prepared(100,200,300);
        allIn(t,new String[][]{{"14S","14D"},{"13S","13D"},{"12S","12D"}},100,200,300);
        // Short stack wins main pot, middle stack wins side pot, deep stack gets uncalled chips back. Nobody busts.
        assertThat(t.resetPending).isFalse();assertThat(t.bountyAwards).isEmpty();
        var u=prepared(100,200,300);
        allIn(u,new String[][]{{"12S","12D"},{"14S","14D"},{"13S","13D"}},100,200,300);
        assertThat(u.member("p1").bountyUnits).isEqualTo(60);assertThat(u.bountyAwards).hasSize(1);assertThat(u.member("p2").bountyUnits).isZero();
    }
    @Test void differentPotWinnersReceiveSeparateKnockouts(){
        var t=prepared(100,100,200,300);
        allIn(t,new String[][]{{"14S","14D"},{"12S","12D"},{"9S","9D"},{"13S","13D"}},100,100,200,200);
        assertThat(t.member("p0").bountyUnits).isEqualTo(60);assertThat(t.member("p3").bountyUnits).isEqualTo(60);assertThat(t.bountyAwards).hasSize(2);
    }
    @Test void splitKnockoutDividesOnePointExactly(){
        var t=prepared(100,100,100);
        allIn(t,new String[][]{{"14S","14D"},{"14C","14H"},{"12S","12D"}},100,100,100);
        assertThat(t.member("p0").bountyUnits).isEqualTo(30);assertThat(t.member("p1").bountyUnits).isEqualTo(30);assertThat(t.member("p2").bountyUnits).isZero();
        assertThat(t.players.stream().mapToLong(p->p.bountyUnits).sum()).isEqualTo(60);
    }
    @Test void noKnockoutKeepsStacksAndDoesNotAward(){
        var t=prepared(1000,1000);t.action("p0","FOLD",null,t.version,t.hand);
        assertThat(t.resetPending).isFalse();assertThat(t.member("p1").bountyUnits).isZero();
        t.begin();assertThat(t.member("p1").stack+t.member("p1").committed).isEqualTo(1050);
    }
    @Test void pendingBlindsUsedForResetAndBountySurvives(){
        var t=prepared(10000,10000);t.blinds("p0",100,200);
        allIn(t,new String[][]{{"14S","14D"},{"13S","13D"}},10000,10000);
        t.start("p0");assertThat(t.bb).isEqualTo(200);for(var p:t.players)assertThat(p.stack+p.committed).isEqualTo(20000);
        assertThat(t.member("p0").bountyUnits).isEqualTo(60);
    }
    @Test void departureDoesNotGenerateBounty(){
        var t=prepared(100,200);t.member("p0").leaving=true;t.member("p0").folded=true;t.settle();assertThat(t.bountyAwards).isEmpty();assertThat(t.resetPending).isFalse();
    }
}
