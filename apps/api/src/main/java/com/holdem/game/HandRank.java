package com.holdem.game;

import java.util.*;

/** Pure, deterministic seven-card evaluator. Card = rank(2..14) + suit(CDHS). */
public final class HandRank {
    private HandRank() {}
    public static long evaluate(List<String> cards) {
        if (cards.size() < 5 || cards.size() > 7 || new HashSet<>(cards).size() != cards.size()) throw new IllegalArgumentException("Invalid cards");
        long best = 0;
        for (int a=0;a<cards.size()-4;a++) for(int b=a+1;b<cards.size()-3;b++)
            for(int c=b+1;c<cards.size()-2;c++) for(int d=c+1;d<cards.size()-1;d++)
                for(int e=d+1;e<cards.size();e++) best=Math.max(best, five(List.of(cards.get(a),cards.get(b),cards.get(c),cards.get(d),cards.get(e))));
        return best;
    }
    private static long five(List<String> cards) {
        Map<Integer,Integer> counts=new HashMap<>();
        for(String c:cards) counts.merge(Integer.parseInt(c.substring(0,c.length()-1)),1,Integer::sum);
        List<Integer> ranks=new ArrayList<>(counts.keySet()); ranks.sort(Comparator.reverseOrder());
        boolean flush=cards.stream().map(c->c.charAt(c.length()-1)).distinct().count()==1;
        int straight=0;
        if(ranks.size()==5) {
            if(ranks.getFirst()-ranks.getLast()==4) straight=ranks.getFirst();
            else if(ranks.equals(List.of(14,5,4,3,2))) straight=5;
        }
        if(flush && straight>0) return score(8,List.of(straight));
        List<Integer> grouped=new ArrayList<>(ranks);
        grouped.sort(Comparator.<Integer>comparingInt(counts::get).reversed().thenComparing(Comparator.reverseOrder()));
        int first=counts.get(grouped.getFirst());
        if(first==4) return score(7,grouped);
        if(first==3 && counts.get(grouped.get(1))==2) return score(6,grouped);
        if(flush) return score(5,ranks);
        if(straight>0) return score(4,List.of(straight));
        if(first==3) return score(3,grouped);
        if(first==2 && counts.get(grouped.get(1))==2) return score(2,grouped);
        if(first==2) return score(1,grouped);
        return score(0,ranks);
    }
    private static long score(int category,List<Integer> ranks) {
        long result=category;
        for(int i=0;i<5;i++) result=result*15+(i<ranks.size()?ranks.get(i):0);
        return result;
    }
    public static String label(long rank) { return new String[]{"High Card","One Pair","Two Pair","Three of a Kind","Straight","Flush","Full House","Four of a Kind","Straight Flush"}[(int)(rank/759375)]; }
}
